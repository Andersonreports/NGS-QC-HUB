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
import re
from pathlib import Path

import openpyxl
from sqlalchemy.orm import Session

from . import models

QC_PASS_DEFAULT = "Pass"
RESEQUENCING_DEFAULT = "No"


def _name_key(value) -> str:
    """Case, spaces, underscores and punctuation ignored: 'Sample Info', 'Sample-Info'
    and 'sample_info' are the same tab; 'Gen_ID' and 'Gen ID' the same column."""
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


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
    if sheet_name and sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
    else:
        # Default to the sample tab when the workbook has one — its rows are the samples
        # the Primary Head makes QC decisions on. Otherwise fall back to whichever tab
        # the file was saved on, as before.
        sample_tab = next((n for n in wb.sheetnames if _name_key(n) == "sampleinfo"), None)
        ws = wb[sample_tab] if sample_tab else wb.active
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
    # On a sample tab (one with a Gen_ID or Test column), keep only actual sample rows.
    # Sub-header or note rows with neither value (e.g. a "Results / Invalid Genotype"
    # line) are not samples, and would otherwise make the sheet one row longer than the
    # sample list. Tabs without those columns (e.g. HS-metrics) are loaded unchanged.
    sample_cols = [j for j, c in enumerate(columns) if _name_key(c) in ("genid", "test")]
    if sample_cols:
        data_rows = [
            r for r in data_rows
            if any(j < len(r) and r[j] is not None and str(r[j]).strip() != "" for j in sample_cols)
        ]
    wb.close()

    sheet = db.query(models.Sheet).filter(models.Sheet.run_id == run.id).first()
    prev_columns = json.loads(sheet.columns_json) if sheet else []
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
    # QC decisions belong to samples. If the previous tab had no Sample_ID column (e.g. the
    # transposed HS-metrics tab) its row positions were never samples, so don't carry them
    # onto the sample rows of this one.
    if "sampleid" not in {_name_key(c) for c in prev_columns} and "sampleid" in {_name_key(c) for c in columns}:
        old_qc = {}
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


def _cell_value(v):
    """JSON-safe, display-ready cell value; None for blanks."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, (int, float, str)):
        return v.strip() if isinstance(v, str) else v
    return str(v)


def _derived_total_gb(reads, size):
    """The workbook's own Total Data Generated formula (reads x read length / 1e9, in GB),
    used only when the file was saved without calculated values for that column."""
    try:
        n = float(str(reads).replace("M", "").strip()) * 1_000_000
        length = float(str(size).lower().replace("bp", "").strip())
    except (TypeError, ValueError):
        return None
    return f"{round(n * length / 1e9, 2)} GB"


def _find_sheet(wb, predicate):
    name = next((n for n in wb.sheetnames if predicate(_name_key(n))), None)
    return wb[name] if name else None


def read_sample_metrics(file_path: str) -> dict:
    """Fastp (before/after) and HS-metrics values per Sample_ID from a consolidated
    workbook. Fastp is one row per sample under a two-level BEFORE/AFTER header; HS-metrics
    is transposed — one column per sample, metric names down the first column."""
    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    try:
        fastp: dict = {}
        ws = _find_sheet(wb, lambda k: k == "fastp")
        if ws is not None:
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            hdr = next((i for i, r in enumerate(rows) if any(_name_key(c) == "sampleid" for c in r if c is not None)), None)
            if hdr is not None:
                keys = [_name_key(c) if c is not None else "" for c in rows[hdr]]
                id_col = keys.index("sampleid")
                reads_cols = [j for j, k in enumerate(keys) if k == "numberofreads"]
                fields = {"reads": "numberofreads", "size": "sizeofreads", "q30": "q30", "total": "totaldatagenerated"}

                def group(start, end):
                    cols = {}
                    for name, key in fields.items():
                        cols[name] = next((j for j in range(start, end) if keys[j] == key), None)
                    return cols

                if reads_cols:
                    before_start = reads_cols[0]
                    after_start = reads_cols[1] if len(reads_cols) > 1 else len(keys)
                    before = group(before_start, after_start)
                    after = group(after_start, len(keys)) if len(reads_cols) > 1 else {}
                    for r in rows[hdr + 1:]:
                        sid = _cell_value(r[id_col]) if id_col < len(r) else None
                        if not sid:
                            continue
                        pick = lambda cols: {n: (_cell_value(r[j]) if j is not None and j < len(r) else None) for n, j in cols.items()} if cols else {}
                        entry = {"before": pick(before), "after": pick(after)}
                        for part in entry.values():
                            if part and part.get("total") is None:
                                part["total"] = _derived_total_gb(part.get("reads"), part.get("size"))
                        fastp[str(sid)] = entry

        hs: dict = {}
        hs_metrics: list = []
        ws = _find_sheet(wb, lambda k: k.startswith("hsmetric"))
        if ws is not None:
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            start = next((i for i, r in enumerate(rows) if any(_name_key(c) == "genomesize" for c in r[:3] if c is not None)), None)
            if start is not None and start > 0:
                label_col = next(j for j, c in enumerate(rows[start][:3]) if c is not None and _name_key(c) == "genomesize")
                ids_row = rows[start - 1]
                metric_rows = [r for r in rows[start:] if label_col < len(r) and _cell_value(r[label_col]) is not None]
                hs_metrics = [str(r[label_col]).strip() for r in metric_rows]
                for j, sid in enumerate(ids_row):
                    sid = _cell_value(sid)
                    if j == label_col or not sid:
                        continue
                    hs[str(sid)] = {
                        str(r[label_col]).strip(): (_cell_value(r[j]) if j < len(r) else None)
                        for r in metric_rows
                    }
        return {"fastp": fastp, "hs": hs, "hs_metrics": hs_metrics}
    finally:
        wb.close()
