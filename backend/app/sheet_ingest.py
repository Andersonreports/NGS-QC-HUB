"""Parses an uploaded consolidated Excel into the live, editable Sheet/SheetRow records.

Cell data is always refreshed from the latest upload (that's the point of a re-upload
after a send-back), but QC Pass / Re-Sequencing decisions and every note/flag are keyed
by row index and column name, so they survive a re-upload as long as the row is still
at the same position.

Real lab QC exports are often not a simple one-row-header table — a workbook can have
several tabs (e.g. Picard HS-metrics output ships "Standard AL" / "Sample Info" / "Fastp"
/ "HS-metrics" side by side), and openpyxl's `wb.active` is whichever tab happened to be
selected when the file was last saved, not necessarily the one that matters. So the sheet
tab is a caller-supplied choice with a sane default, not a silent guess the user can't see
or correct.
"""
import json
from pathlib import Path

import openpyxl
from sqlalchemy.orm import Session

from . import models

QC_PASS_DEFAULT = "Pass"
RESEQUENCING_DEFAULT = "No"


def looks_like_excel(filename: str) -> bool:
    return Path(filename).suffix.lower() in (".xlsx", ".xlsm", ".xls")


def list_sheet_names(file_path: str) -> list[str]:
    wb = openpyxl.load_workbook(file_path, read_only=True)
    try:
        return list(wb.sheetnames)
    finally:
        wb.close()


def ingest_consolidated_excel(
    db: Session, run: models.Run, file_path: str, filename: str,
    sheet_name: str | None = None, attachment_id: str | None = None,
) -> models.Sheet:
    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
    chosen_name = ws.title

    rows_iter = ws.iter_rows(values_only=True)
    header_row = next(rows_iter, None) or ()
    columns = [str(c).strip() if c is not None and str(c).strip() else f"Column {i+1}" for i, c in enumerate(header_row)]
    # De-duplicate identical/blank header names so each column has a distinct key.
    seen: dict[str, int] = {}
    unique_columns = []
    for col in columns:
        seen[col] = seen.get(col, 0) + 1
        unique_columns.append(col if seen[col] == 1 else f"{col} ({seen[col]})")
    columns = unique_columns

    data_rows = [r for r in rows_iter if any(v is not None and str(v).strip() != "" for v in r)]
    wb.close()

    sheet = db.query(models.Sheet).filter(models.Sheet.run_id == run.id).first()
    if not sheet:
        sheet = models.Sheet(
            run_id=run.id, columns_json=json.dumps(columns), source_filename=filename,
            source_sheet_name=chosen_name, source_attachment_id=attachment_id,
        )
        db.add(sheet)
        db.flush()
    else:
        sheet.columns_json = json.dumps(columns)
        sheet.source_filename = filename
        sheet.source_sheet_name = chosen_name
        if attachment_id:
            sheet.source_attachment_id = attachment_id

    old_rows = db.query(models.SheetRow).filter(models.SheetRow.sheet_id == sheet.id).all()
    old_qc = {r.row_index: (r.qc_pass, r.resequencing) for r in old_rows}
    for r in old_rows:
        db.delete(r)
    db.flush()

    for i, values in enumerate(data_rows):
        cells = {
            columns[j]: ("" if j >= len(values) or values[j] is None else str(values[j]))
            for j in range(len(columns))
        }
        qc_pass, resequencing = old_qc.get(i, (QC_PASS_DEFAULT, RESEQUENCING_DEFAULT))
        db.add(models.SheetRow(
            sheet_id=sheet.id, row_index=i, cells_json=json.dumps(cells),
            qc_pass=qc_pass, resequencing=resequencing,
        ))

    return sheet
