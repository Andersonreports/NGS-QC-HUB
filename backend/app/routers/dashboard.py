"""Total Work Done dashboard: sample and QC totals computed on demand from the
consolidated Excel in every work folder under UPLOADS_DIR — but only for runs whose
consolidated Excel has been approved by a head (see `_is_approved`). Folders still
pending approval are skipped and listed under "not counted".

Nothing is stored or hardcoded — each request re-scans the folders, so a new
work folder is included as soon as it exists. Parsed files are cached by
(path, mtime, size) so repeat polls don't re-read unchanged workbooks.
"""
import hashlib
import json
import re
from datetime import date, datetime
from pathlib import Path

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fpdf import FPDF
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..config import UPLOADS_DIR
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

EXCEL_SUFFIXES = {".xlsx", ".xlsm"}
SHEET_NAME = "sample_info"  # matched via _key(), see below
HEADER_SEARCH_ROWS = 15  # the header row is normally row 1, but tolerate a title above it

_WES_MITO = re.compile(r"^WES\s*\+\s*MITT?O$")
_parse_cache: dict[tuple[str, float, int], tuple[list[str], list[str], list[dict]]] = {}


def _key(value) -> str:
    """Name comparison key: case, spaces, underscores and punctuation ignored, so
    'sample_info', 'Sample Info' and 'SAMPLE-INFO' (or 'Gen_ID' / 'Gen ID') all match."""
    return re.sub(r"[^a-z0-9]", "", str(value).lower()) if value is not None else ""


def _norm(value) -> str:
    return re.sub(r"\s+", " ", str(value)).strip().upper() if value is not None else ""


_DATE_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})")
_DATE_DMY = re.compile(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})")


def _parse_date(value) -> tuple[str, str, str] | None:
    """(year, month, ISO date) from a sample's Date cell, or None when it has no
    readable date. Accepts a real date (Excel), 2026-04-23, or 23/04/2026 (also - or .)."""
    if isinstance(value, (datetime, date)):
        y, m, d = value.year, value.month, value.day
    else:
        t = str(value).strip() if value is not None else ""
        hit = _DATE_ISO.match(t)
        if hit:
            y, m, d = int(hit[1]), int(hit[2]), int(hit[3])
        else:
            hit = _DATE_DMY.match(t)
            if not hit:
                return None
            d, m, y = int(hit[1]), int(hit[2]), int(hit[3])
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None
    return f"{y:04d}", f"{m:02d}", f"{y:04d}-{m:02d}-{d:02d}"


def _in_period(year: str, month: str, want_year: str | None, want_month: str | None) -> bool:
    """Whether a sample dated (year, month) falls in the chosen period. A sample with
    no date ("" , "") only matches when no period is chosen."""
    if want_year and year != want_year:
        return False
    if want_month and month != want_month:
        return False
    return True


def _find_consolidated(folder: Path) -> Path | None:
    """Newest Excel in the folder whose name contains 'consolidated' (any case)."""
    candidates = [
        p for p in folder.iterdir()
        if p.is_file()
        and p.suffix.lower() in EXCEL_SUFFIXES
        and "consolidated" in p.name.lower()
        and not p.name.startswith("~$")  # Excel's lock/temp files
    ]
    return max(candidates, key=lambda p: p.stat().st_mtime, default=None)


def _read_columns(path: Path) -> tuple[list[str], list[str], list[dict]]:
    """(test values, gen_id values, sample rows) from the sample_info sheet. The first
    two feed the counts; the rows keep each sample's identifying fields so the dashboard
    can list the samples behind a number. Raises ValueError with a short human reason
    when the file can't be used."""
    stat = path.stat()
    key = (str(path.resolve()), stat.st_mtime, stat.st_size)
    if key in _parse_cache:
        return _parse_cache[key]

    try:
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    except Exception:
        raise ValueError("not a readable Excel file")
    try:
        sheet_name = next((n for n in wb.sheetnames if _key(n) == _key(SHEET_NAME)), None)
        if not sheet_name:
            raise ValueError(f"no '{SHEET_NAME}' worksheet")

        rows = wb[sheet_name].iter_rows(values_only=True)
        test_idx = gen_idx = id_idx = name_idx = date_idx = desc_idx = None
        for _ in range(HEADER_SEARCH_ROWS):
            header = next(rows, None)
            if header is None:
                break
            names = [_key(h) for h in header]
            if "test" in names or "genid" in names:
                test_idx = names.index("test") if "test" in names else None
                gen_idx = names.index("genid") if "genid" in names else None
                id_idx = names.index("sampleid") if "sampleid" in names else None
                name_idx = names.index("samplename") if "samplename" in names else None
                date_idx = names.index("date") if "date" in names else None
                desc_idx = names.index("description") if "description" in names else None
                break
        if test_idx is None and gen_idx is None:
            raise ValueError("no 'test' or 'gen_id' column")

        def cell(row, idx) -> str:
            return str(row[idx]).strip() if idx is not None and idx < len(row) and row[idx] is not None else ""

        tests, gen_ids, samples = [], [], []
        for row in rows:
            t = ""
            if test_idx is not None and test_idx < len(row):
                t = _norm(row[test_idx])
                if t:
                    tests.append(t)
            g = ""
            if gen_idx is not None and gen_idx < len(row) and row[gen_idx] is not None:
                g = re.sub(r"\s+", "", str(row[gen_idx])).upper()
                if g:
                    gen_ids.append(g)
            if t or g:
                when = _parse_date(row[date_idx]) if date_idx is not None and date_idx < len(row) else None
                samples.append({
                    "sample_id": cell(row, id_idx),
                    "sample_name": cell(row, name_idx),
                    "description": cell(row, desc_idx),
                    "gen_id": cell(row, gen_idx),
                    "test": cell(row, test_idx),
                    "test_norm": t,
                    "gen_norm": g,
                    "has_test": bool(t),
                    "is_reseq": g.endswith("A"),
                    "year": when[0] if when else "",
                    "month": when[1] if when else "",
                    "date": when[2] if when else "",
                })
    finally:
        wb.close()

    _parse_cache[key] = (tests, gen_ids, samples)
    return tests, gen_ids, samples


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _count_samples(tests: list[str]) -> dict:
    wes = wes_mito = wgs = panel = mito = ces = 0
    others = 0
    for t in tests:
        before = (wes, wes_mito, wgs, panel, mito, ces)
        if t in ("WES", "WHOLE EXOME SEQUENCING"):  # two names for the same test
            wes += 1
        elif _WES_MITO.match(t):
            wes_mito += 1  # counted under WES only, never again under MITO
        elif "MITO" in t or "MITTO" in t:
            if "WES" not in t:
                mito += 1
        if "WGS" in t:
            wgs += 1
        if "PANEL" in t:
            panel += 1
        if "CES" in t:
            ces += 1
        # Others: a sample none of the categories above picked up. Decided from the
        # counters themselves, so the category rules stay exactly as written above and
        # a sample is never in Others and another card at once.
        if (wes, wes_mito, wgs, panel, mito, ces) == before:
            others += 1
    return {
        "wes": {
            "total": wes + wes_mito,
            "wes": wes,
            "wes_mito": wes_mito,
        },
        "wgs": wgs,
        "panel": panel,
        "mito": mito,
        "ces": ces,
        "others": others,
    }


APPROVER_ROLES = {"primary_head", "bioinfo_head"}
CONSOLIDATED_STAGE = "excel_uploaded"


def _is_approved(history: list) -> bool:
    """Whether the run's *current* consolidated Excel has been approved by a head
    (Primary Team Head or Bioinfo Team Head). Replays the history in order:

      - a head's approval marks it approved;
      - a (re-)upload of the Excel, its removal, or any reviewer sending the run back
        clears that approval — the approved file is no longer the one on the run, or
        the run has gone back for changes — until a head approves again.

    Approvals by other roles (Wet Lab) neither grant nor revoke it."""
    approved = False
    for h in sorted(history, key=lambda h: h.created_at):
        if h.action == "approved" and h.actor_role in APPROVER_ROLES:
            approved = True
        elif h.action in ("rejected", "reset"):
            approved = False
        elif h.stage_id == CONSOLIDATED_STAGE and h.action == "completed":
            approved = False
    return approved


def _approved_run_numbers(db: Session) -> set[str]:
    runs = db.query(models.Run).options(joinedload(models.Run.history)).all()
    return {r.run_number for r in runs if _is_approved(r.history)}


def _row_date(cells_json: str) -> tuple[str, str, str]:
    """(year, month, ISO date) of a My Work sheet row, from its Date column — blanks
    when the row has none."""
    try:
        cells = json.loads(cells_json)
    except ValueError:
        return "", "", ""
    for column, value in cells.items():
        if _key(column) == "date":
            return _parse_date(value) or ("", "", "")
    return "", "", ""


def _head_qc_counts(
    db: Session, run_numbers: list[str], year: str | None = None, month: str | None = None,
) -> dict:
    """Pass / Fail sample counts from the QC status Primary Team Head sets on each
    sample row of a run's sheet (SheetRow.qc_pass), for the runs being counted.
    Read as-is — the edit endpoint and its validation are untouched. A row the head
    hasn't touched is "Pass", the sheet's own default."""
    counts = {"pass": 0, "fail": 0}
    if not run_numbers:
        return counts
    if year or month:
        # For a month/year, each row's own Date decides — so read the rows, not a group count.
        dated = (
            db.query(models.SheetRow.qc_pass, models.SheetRow.cells_json)
            .join(models.Sheet, models.SheetRow.sheet_id == models.Sheet.id)
            .join(models.Run, models.Sheet.run_id == models.Run.id)
            .filter(models.Run.run_number.in_(run_numbers))
            .all()
        )
        for status_value, cells_json in dated:
            when = _row_date(cells_json)
            if status_value in ("Pass", "Fail") and _in_period(when[0], when[1], year, month):
                counts[status_value.lower()] += 1
        return counts
    rows = (
        db.query(models.SheetRow.qc_pass, func.count(models.SheetRow.id))
        .join(models.Sheet, models.SheetRow.sheet_id == models.Sheet.id)
        .join(models.Run, models.Sheet.run_id == models.Run.id)
        .filter(models.Run.run_number.in_(run_numbers))
        .group_by(models.SheetRow.qc_pass)
        .all()
    )
    for status_value, n in rows:
        if status_value == "Pass":
            counts["pass"] = n
        elif status_value == "Fail":
            counts["fail"] = n
    return counts


def _scan(db: Session) -> dict:
    """Walk the work folders once: apply the approval gate, read each approved run's
    consolidated Excel, and gather what both the counts and the sample lists need."""
    tests: list[str] = []
    gen_ids: list[str] = []
    samples: list[dict] = []  # one entry per sample row, tagged with its run
    processed: list[str] = []
    skipped: list[dict] = []
    seen_hashes: dict[str, str] = {}

    approved = _approved_run_numbers(db)
    folders = sorted(p for p in UPLOADS_DIR.iterdir() if p.is_dir()) if UPLOADS_DIR.exists() else []
    for folder in folders:
        if folder.name not in approved:
            skipped.append({"folder": folder.name, "reason": "pending approval"})
            continue
        try:
            path = _find_consolidated(folder)
            if path is None:
                skipped.append({"folder": folder.name, "reason": "no consolidated Excel file"})
                continue
            digest = _file_hash(path)
            if digest in seen_hashes:
                skipped.append({"folder": folder.name, "reason": f"duplicate of {seen_hashes[digest]}"})
                continue
            file_tests, file_gen_ids, file_samples = _read_columns(path)
        except ValueError as e:
            skipped.append({"folder": folder.name, "reason": str(e)})
            continue
        except OSError:
            skipped.append({"folder": folder.name, "reason": "file could not be read"})
            continue
        seen_hashes[digest] = folder.name
        processed.append(folder.name)
        tests.extend(file_tests)
        gen_ids.extend(file_gen_ids)
        samples.extend({**s, "run": folder.name} for s in file_samples)

    return {
        "tests": tests, "gen_ids": gen_ids, "samples": samples,
        "processed": processed, "skipped": skipped, "folders": len(folders),
    }


def _periods(samples: list[dict]) -> list[dict]:
    """Every (year, month) that has at least one dated sample, newest first, with its
    sample count — what the Year / Month dropdowns offer. Always from all samples, so
    the options don't shrink once a filter is chosen."""
    counts: dict[tuple[str, str], int] = {}
    for s in samples:
        if s["year"]:
            counts[(s["year"], s["month"])] = counts.get((s["year"], s["month"]), 0) + 1
    return [
        {"year": y, "month": m, "count": n}
        for (y, m), n in sorted(counts.items(), reverse=True)
    ]


def _compute(db: Session, year: str | None = None, month: str | None = None) -> dict:
    scan = _scan(db)
    processed = scan["processed"]
    if year or month:
        picked = [s for s in scan["samples"] if _in_period(s["year"], s["month"], year, month)]
        tests = [s["test_norm"] for s in picked if s["has_test"]]
        gen_ids = [s["gen_norm"] for s in picked if s["gen_norm"]]
    else:
        tests, gen_ids = scan["tests"], scan["gen_ids"]
    return {
        # "total" is every sample with a test type, counted once — not the sum of the cards,
        # which can overlap when one test name matches two categories.
        "sample": {**_count_samples(tests), "total": len(tests)},
        "qc": {
            # Pass / Fail are the Primary Team Head's own per-sample QC decisions from the
            # My Work sheet, so they follow every change the head makes there.
            **_head_qc_counts(db, processed, year, month),
            "resequence": sum(1 for g in gen_ids if g.endswith("A")),
        },
        "meta": {
            "folders_scanned": scan["folders"],
            "files_processed": len(processed),
            "folders_processed": processed,
            "skipped": scan["skipped"],
            "periods": _periods(scan["samples"]),
            "filter": {"year": year, "month": month},
        },
    }


def _check_period(year: str | None, month: str | None) -> tuple[str | None, str | None]:
    """Query-string year / month, validated (empty means no filter)."""
    year, month = (year or "").strip() or None, (month or "").strip() or None
    if year and not re.fullmatch(r"\d{4}", year):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "year must be 4 digits, e.g. 2026")
    if month:
        if not re.fullmatch(r"\d{1,2}", month) or not 1 <= int(month) <= 12:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "month must be 01 to 12")
        month = f"{int(month):02d}"
    return year, month


@router.get("/total-work-done")
def total_work_done(
    year: str | None = None, month: str | None = None,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    year, month = _check_period(year, month)
    return _compute(db, year, month)


SAMPLE_LIST_LABELS = {
    "total": "Total samples",
    "pass": "QC pass",
    "fail": "QC fail",
    "resequence": "Resequence",
}


def _qc_rows(
    db: Session, run_numbers: list[str], status_value: str,
    year: str | None = None, month: str | None = None,
) -> list[dict]:
    """The My Work sheet rows the Primary Head has marked Pass / Fail (the same rows
    `_head_qc_counts` counts), with whatever identifying columns the sheet has. A sheet
    without Sample ID / Gen_ID / Test columns (e.g. an HS-metrics tab) falls back to the
    row's first non-empty cell, so the list still matches the card's number."""
    if not run_numbers:
        return []
    found = (
        db.query(models.Run.run_number, models.SheetRow.row_index, models.SheetRow.cells_json)
        .join(models.Sheet, models.Sheet.run_id == models.Run.id)
        .join(models.SheetRow, models.SheetRow.sheet_id == models.Sheet.id)
        .filter(models.Run.run_number.in_(run_numbers), models.SheetRow.qc_pass == status_value)
        .order_by(models.Run.run_number, models.SheetRow.row_index)
        .all()
    )
    out = []
    for run_number, row_index, cells_json in found:
        try:
            cells = json.loads(cells_json)
        except ValueError:
            cells = {}
        by_key = {_key(k): str(v).strip() for k, v in cells.items() if v is not None and str(v).strip()}
        when = _row_date(cells_json)
        if (year or month) and not _in_period(when[0], when[1], year, month):
            continue
        item = {
            "date": when[2],
            "run": run_number,
            "sample_id": by_key.get("sampleid", ""),
            "sample_name": by_key.get("samplename", ""),
            "description": by_key.get("description", ""),
            "gen_id": by_key.get("genid", ""),
            "test": by_key.get("test", ""),
            "qc": status_value,
        }
        if not (item["sample_id"] or item["sample_name"] or item["gen_id"] or item["test"]):
            first = next(iter(by_key.values()), "")
            item["sample_id"] = f"Row {row_index + 1}" + (f": {first}" if first else "")
        out.append(item)
    return out


@router.get("/total-work-done/samples")
def total_work_done_samples(
    category: str, year: str | None = None, month: str | None = None,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    """The samples behind one of the headline numbers. Uses the same approved runs and
    the same rules as the counts, so the list length always equals the card's number."""
    if category not in SAMPLE_LIST_LABELS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"category must be one of: {', '.join(SAMPLE_LIST_LABELS)}",
        )
    year, month = _check_period(year, month)
    scan = _scan(db)
    if category in ("pass", "fail"):
        items = _qc_rows(db, scan["processed"], "Pass" if category == "pass" else "Fail", year, month)
    else:
        pick = (lambda s: s["has_test"]) if category == "total" else (lambda s: s["is_reseq"])
        items = [
            {
                "run": s["run"], "sample_id": s["sample_id"], "sample_name": s["sample_name"],
                "description": s["description"],
                "gen_id": s["gen_id"], "test": s["test"], "qc": None, "date": s["date"],
            }
            for s in scan["samples"]
            if pick(s) and _in_period(s["year"], s["month"], year, month)
        ]
    return {"category": category, "label": SAMPLE_LIST_LABELS[category], "count": len(items), "samples": items}


# Formats the export button offers. Add a new one by writing a builder and listing it here.
EXPORT_FORMATS = {"pdf"}


MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _period_label(year: str | None, month: str | None) -> str:
    if month and year:
        return f"{MONTH_NAMES[int(month) - 1]} {year}"
    if month:
        return f"{MONTH_NAMES[int(month) - 1]} (all years)"
    return year or ""


def _build_pdf(data: dict) -> bytes:
    s, qc, meta = data["sample"], data["qc"], data["meta"]
    period = _period_label(meta.get("filter", {}).get("year"), meta.get("filter", {}).get("month"))
    sections = [
        ("Sample", [
            ("Total samples", s["total"], True),
            ("WES (total)", s["wes"]["total"], True),
            ("WES", s["wes"]["wes"], False),
            ("WES + Mito", s["wes"]["wes_mito"], False),
            ("WGS", s["wgs"], True),
            ("Panel", s["panel"], True),
            ("Mito", s["mito"], True),
            ("CES", s["ces"], True),
            ("Others", s["others"], True),
        ]),
        ("QC", [
            ("Pass", qc["pass"], True),
            ("Fail", qc["fail"], True),
            ("Resequence", qc["resequence"], True),
        ]),
    ]

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 10, "Total Work Done", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(
        0, 6,
        f"Generated {datetime.now().strftime('%d %b %Y, %H:%M')}  |  "
        f"{meta['files_processed']} of {meta['folders_scanned']} work folders counted"
        + (f"  |  Period: {period}" if period else ""),
        new_x="LMARGIN", new_y="NEXT",
    )
    pdf.set_text_color(0, 0, 0)
    pdf.ln(6)

    for title, rows in sections:
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 9, title, new_x="LMARGIN", new_y="NEXT")
        pdf.set_fill_color(235, 238, 243)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(120, 8, "Metric", border=1, fill=True)
        pdf.cell(60, 8, "Count", border=1, fill=True, align="R", new_x="LMARGIN", new_y="NEXT")
        for label, value, main in rows:
            pdf.set_font("Helvetica", "B" if main else "", 10)
            # Breakdown rows (not a headline card) are indented under their total.
            pdf.cell(120, 8, label if main else f"    {label}", border=1)
            pdf.cell(60, 8, f"{value:,}", border=1, align="R", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(7)

    return bytes(pdf.output())


@router.get("/total-work-done/export")
def export_total_work_done(
    format: str = "pdf", year: str | None = None, month: str | None = None,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    year, month = _check_period(year, month)
    fmt = format.lower()
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported format. Supported: {', '.join(sorted(EXPORT_FORMATS))}",
        )
    filename = f"Total_Work_Done_{datetime.now().strftime('%Y-%m-%d')}.pdf"
    return Response(
        _build_pdf(_compute(db, year, month)),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
