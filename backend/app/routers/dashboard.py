"""Total Work Done dashboard: sample and QC totals computed on demand from the
consolidated Excel in every work folder under UPLOADS_DIR — but only for runs whose
consolidated Excel has been approved by a head (see `_is_approved`). Folders still
pending approval are skipped and listed under "not counted".

Nothing is stored or hardcoded — each request re-scans the folders, so a new
work folder is included as soon as it exists. Parsed files are cached by
(path, mtime, size) so repeat polls don't re-read unchanged workbooks.
"""
import hashlib
import re
from datetime import datetime
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
_parse_cache: dict[tuple[str, float, int], tuple[list[str], list[str]]] = {}


def _key(value) -> str:
    """Name comparison key: case, spaces, underscores and punctuation ignored, so
    'sample_info', 'Sample Info' and 'SAMPLE-INFO' (or 'Gen_ID' / 'Gen ID') all match."""
    return re.sub(r"[^a-z0-9]", "", str(value).lower()) if value is not None else ""


def _norm(value) -> str:
    return re.sub(r"\s+", " ", str(value)).strip().upper() if value is not None else ""


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


def _read_columns(path: Path) -> tuple[list[str], list[str]]:
    """(test values, gen_id values) from the sample_info sheet. Raises ValueError
    with a short human reason when the file can't be used."""
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
        test_idx = gen_idx = None
        for _ in range(HEADER_SEARCH_ROWS):
            header = next(rows, None)
            if header is None:
                break
            names = [_key(h) for h in header]
            if "test" in names or "genid" in names:
                test_idx = names.index("test") if "test" in names else None
                gen_idx = names.index("genid") if "genid" in names else None
                break
        if test_idx is None and gen_idx is None:
            raise ValueError("no 'test' or 'gen_id' column")

        tests, gen_ids = [], []
        for row in rows:
            if test_idx is not None and test_idx < len(row):
                t = _norm(row[test_idx])
                if t:
                    tests.append(t)
            if gen_idx is not None and gen_idx < len(row) and row[gen_idx] is not None:
                g = re.sub(r"\s+", "", str(row[gen_idx])).upper()
                if g:
                    gen_ids.append(g)
    finally:
        wb.close()

    _parse_cache[key] = (tests, gen_ids)
    return tests, gen_ids


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


def _head_qc_counts(db: Session, run_numbers: list[str]) -> dict:
    """Pass / Fail sample counts from the QC status Primary Team Head sets on each
    sample row of a run's sheet (SheetRow.qc_pass), for the runs being counted.
    Read as-is — the edit endpoint and its validation are untouched. A row the head
    hasn't touched is "Pass", the sheet's own default."""
    counts = {"pass": 0, "fail": 0}
    if not run_numbers:
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


def _compute(db: Session) -> dict:
    tests: list[str] = []
    gen_ids: list[str] = []
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
            file_tests, file_gen_ids = _read_columns(path)
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

    return {
        "sample": _count_samples(tests),
        "qc": {
            # Pass / Fail are the Primary Team Head's own per-sample QC decisions from the
            # My Work sheet, so they follow every change the head makes there.
            **_head_qc_counts(db, processed),
            "resequence": sum(1 for g in gen_ids if g.endswith("A")),
        },
        "meta": {
            "folders_scanned": len(folders),
            "files_processed": len(processed),
            "folders_processed": processed,
            "skipped": skipped,
        },
    }


@router.get("/total-work-done")
def total_work_done(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return _compute(db)



# Formats the export button offers. Add a new one by writing a builder and listing it here.
EXPORT_FORMATS = {"pdf"}


def _build_pdf(data: dict) -> bytes:
    s, qc, meta = data["sample"], data["qc"], data["meta"]
    sections = [
        ("Sample", [
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
        f"{meta['files_processed']} of {meta['folders_scanned']} work folders counted",
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
    format: str = "pdf", db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    fmt = format.lower()
    if fmt not in EXPORT_FORMATS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported format. Supported: {', '.join(sorted(EXPORT_FORMATS))}",
        )
    filename = f"Total_Work_Done_{datetime.now().strftime('%Y-%m-%d')}.pdf"
    return Response(
        _build_pdf(_compute(db)),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
