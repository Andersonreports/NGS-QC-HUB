import re
from datetime import datetime
from io import BytesIO
from pathlib import Path

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import extract
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user, require_role

router = APIRouter(prefix="/api/reports", tags=["reports"])

# Every consolidated Excel Primary Team uploads carries a "summary" tab with exactly
# one data row — Run, Test, Number of samples, Rawdata backup size, etc. — matching
# the reference report format 1:1. The monthly report is just that one row from every
# run transferred that month, stacked into one table, plus a totals row.
TITLE = "Sno", "Run", "Test", "Number of samples", "Rawdata backup (Consolidated ) size", \
    "Radata Backup drive", "Data_received", "shared to exome group", "itdose", \
    "Output Backup drive", "Coverage", "Done by"


def _validate_month(year: int, month: int) -> None:
    if not (1 <= month <= 12):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "month must be between 1 and 12")
    if not (2000 <= year <= 2100):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "year looks out of range")


def _runs_for_month(db: Session, year: int, month: int):
    # Grouped by the transfer date — the date Wet Lab marked as transferred, which is
    # the date Primary Team treats as "received" — not anything inside the Excel.
    return (
        db.query(models.Run)
        .filter(
            extract("year", models.Run.created_at) == year,
            extract("month", models.Run.created_at) == month,
        )
        .order_by(models.Run.created_at.asc())
        .all()
    )


def _current_attachment(db: Session, run: models.Run) -> models.Attachment | None:
    """The run's current consolidated-Excel attachment, or None if there isn't
    one right now — either never uploaded, or removed and not yet replaced.
    Whether this is set (not whether a "summary" tab happens to be in it) is
    what decides whether the run appears in the monthly report at all — its
    rows are meant to match the files actually on the run's dashboard."""
    sheet = db.query(models.Sheet).filter(models.Sheet.run_id == run.id).first()
    if not sheet or not sheet.source_attachment_id:
        return None
    attachment = db.query(models.Attachment).filter(models.Attachment.id == sheet.source_attachment_id).first()
    if not attachment or not Path(attachment.stored_path).exists():
        return None
    return attachment


def _read_summary_row(attachment: models.Attachment | None) -> dict:
    """The consolidated Excel's own "summary" tab, as a {header: value} dict — every
    field for this run except Sno and Data_received, which come from our own records.
    Empty dict if there's no consolidated Excel right now, or it has no such tab."""
    if not attachment:
        return {}
    try:
        wb = openpyxl.load_workbook(attachment.stored_path, data_only=True, read_only=True)
    except Exception:
        return {}
    summary_name = next((n for n in wb.sheetnames if n.strip().lower() == "summary"), None)
    if not summary_name:
        return {}
    rows = list(wb[summary_name].iter_rows(values_only=True))
    if len(rows) < 2:
        return {}
    headers = [str(h).strip() if h is not None else "" for h in rows[0]]
    data = rows[1]
    return {headers[i]: data[i] for i in range(min(len(headers), len(data))) if headers[i]}


def _cell_str(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%d-%b-%Y")
    return str(value).replace("\xa0", " ").strip()


SIZE_RE = re.compile(r"^\s*([\d.]+)\s*([a-zA-Z]+)\s*$")
SIZE_UNITS_TO_GB = {"TB": 1024, "GB": 1, "MB": 1 / 1024}


def _parse_size_gb(value):
    """'332.4 GB' / '1.2 TB' -> float GB, or None if it's not a recognizable size
    (e.g. "Ongoing")."""
    text = _cell_str(value)
    m = SIZE_RE.match(text)
    if not m:
        return None
    factor = SIZE_UNITS_TO_GB.get(m.group(2).upper())
    if factor is None:
        return None
    return float(m.group(1)) * factor


def _format_size_gb(total_gb: float) -> str:
    if total_gb >= 1024:
        return f"{total_gb / 1024:.2f} TB"
    return f"{total_gb:.1f} GB"


# Fields Primary Team Head can correct by hand — everything read from the summary
# tab except identity/derived fields (Sno is a position, Run and Data_received are
# tied to the run record itself, not something to override per month).
EDITABLE_FIELDS = {
    "test", "number_of_samples", "rawdata_backup_size", "rawdata_backup_drive",
    "shared_to_exome_group", "itdose", "output_backup_drive", "coverage", "done_by",
}


def _get_override(db: Session, run_id: str) -> models.MonthlyReportOverride | None:
    return db.query(models.MonthlyReportOverride).filter(models.MonthlyReportOverride.run_id == run_id).first()


def _override_has_content(override: models.MonthlyReportOverride | None) -> bool:
    return bool(override) and any(getattr(override, f) not in (None, "") for f in EDITABLE_FIELDS)


def _row_for_run(db: Session, run: models.Run, override: models.MonthlyReportOverride | None = None) -> dict:
    attachment = _current_attachment(db, run)
    summary = _read_summary_row(attachment)

    def field(name: str, summary_key: str):
        edited = getattr(override, name, None) if override else None
        if edited not in (None, ""):
            return edited
        return _cell_str(summary.get(summary_key))

    number_of_samples = getattr(override, "number_of_samples", None) if override else None
    if number_of_samples not in (None, ""):
        try:
            number_of_samples = float(number_of_samples)
        except ValueError:
            number_of_samples = None
    else:
        number_of_samples = summary.get("Number of samples")

    return {
        "run_number": run.run_number,
        "run_label": _cell_str(summary.get("Run")) or run.run_number,
        "test": field("test", "Test"),
        "number_of_samples": number_of_samples,
        "rawdata_backup_size": field("rawdata_backup_size", "Rawdata backup (Consolidated ) size"),
        "rawdata_backup_drive": field("rawdata_backup_drive", "Radata Backup drive"),
        "data_received": run.created_at,
        "shared_to_exome_group": field("shared_to_exome_group", "shared to exome group"),
        "itdose": field("itdose", "itdose"),
        "output_backup_drive": field("output_backup_drive", "Output Backup drive"),
        "coverage": field("coverage", "Coverage"),
        "done_by": field("done_by", "Done by"),
        "has_summary": bool(summary) or bool(override),
        # Not part of the response schema — dropped on serialization. Decides
        # whether this run even belongs in the report at all (see callers).
        "has_file": attachment is not None,
    }


def _totals(rows: list[dict]) -> dict:
    sample_counts = [r["number_of_samples"] for r in rows if isinstance(r["number_of_samples"], (int, float))]
    sizes_gb = [g for r in rows if (g := _parse_size_gb(r["rawdata_backup_size"])) is not None]
    return {
        "number_of_samples": sum(sample_counts) if sample_counts else None,
        "rawdata_backup_size": _format_size_gb(sum(sizes_gb)) if sizes_gb else None,
    }


def _rows_for_month(db: Session, year: int, month: int) -> list[dict]:
    """Rows for every run transferred that month that currently has a
    consolidated Excel — a run whose file was removed and not yet re-uploaded
    drops out until it is, and one Primary Team Head has corrected by hand
    stays even without a file. This keeps the report matching what's actually
    on each run's own dashboard, not a stale snapshot of a file that's gone."""
    rows = []
    for run in _runs_for_month(db, year, month):
        override = _get_override(db, run.id)
        row = _row_for_run(db, run, override)
        if row["has_file"] or _override_has_content(override):
            rows.append(row)
    return rows


@router.get("/monthly", response_model=schemas.MonthlyReportOut)
def monthly_report(
    year: int, month: int,
    db: Session = Depends(get_db), _user: models.User = Depends(get_current_user),
):
    """Every run transferred in the given month/year that currently has a
    consolidated Excel, each row read straight from its "summary" tab, with any
    of Primary Team Head's own corrections applied on top — the preview behind
    the "consolidate by month" picker."""
    _validate_month(year, month)
    rows = _rows_for_month(db, year, month)
    return {"year": year, "month": month, "runs": rows, "totals": _totals(rows)}


@router.patch("/monthly/{run_number}/cell", response_model=schemas.MonthlyReportRunOut)
def edit_monthly_report_cell(
    run_number: str, payload: schemas.MonthlyReportCellEdit,
    db: Session = Depends(get_db), _user: models.User = Depends(require_role("primary_head")),
):
    """Correct one field of one run's monthly-report row by hand — Primary Team
    Head only. Stored separately from the consolidated Excel itself; it just wins
    over whatever the "summary" tab says for that field from here on."""
    if payload.field not in EDITABLE_FIELDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{payload.field}' isn't editable here")
    run = db.query(models.Run).filter(models.Run.run_number == run_number).first()
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")

    value = payload.value.strip()
    if payload.field == "number_of_samples" and value:
        try:
            float(value)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Number of samples must be a number")

    override = _get_override(db, run.id)
    if not override:
        override = models.MonthlyReportOverride(run_id=run.id)
        db.add(override)
    setattr(override, payload.field, value or None)
    db.commit()
    db.refresh(override)
    return _row_for_run(db, run, override)


@router.get("/monthly/export.xlsx")
def monthly_report_export(
    year: int, month: int,
    db: Session = Depends(get_db), _user: models.User = Depends(require_role("primary_head")),
):
    """The same table as /monthly, laid out exactly like the reference format, as a
    downloadable .xlsx — Primary Team Head only; everyone else can view the table
    but not download it."""
    _validate_month(year, month)
    rows = _rows_for_month(db, year, month)
    totals = _totals(rows)
    month_label = datetime(year, month, 1).strftime("%B %Y")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append([f"primary & Secondary update -  {month_label}"])
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(TITLE))
    ws.append(list(TITLE))
    for i, row in enumerate(rows, start=1):
        ws.append([
            i,
            row["run_label"],
            row["test"],
            row["number_of_samples"],
            row["rawdata_backup_size"],
            row["rawdata_backup_drive"],
            row["data_received"].strftime("%d/%m/%Y") if row["data_received"] else "",
            row["shared_to_exome_group"],
            row["itdose"],
            row["output_backup_drive"],
            row["coverage"],
            row["done_by"],
        ])
    ws.append([
        "Total", None, None,
        totals["number_of_samples"], totals["rawdata_backup_size"],
        None, None, None, None, None, None, None,
    ])

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"Consolidated_{datetime(year, month, 1).strftime('%B_%Y')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
