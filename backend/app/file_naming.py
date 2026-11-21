"""Naming rule for the consolidated Excel: its filename always contains
"consolidated". The Total Work Done dashboard finds each run's workbook by that word,
so the rule is applied when the file is uploaded (see routers/runs.py) and, once at
startup, to any file uploaded before the rule existed.

Only the filename changes — the file's bytes are never touched.
"""
from pathlib import Path

from sqlalchemy.orm import Session

from . import models
from .sheet_ingest import looks_like_excel

CONSOLIDATED_STAGE = "excel_uploaded"
SUFFIX = "_consolidated"


def with_consolidated_suffix(filename: str) -> str:
    """'Run108A_Exome sample (5).xlsx' -> 'Run108A_Exome sample (5)_consolidated.xlsx'.
    Left alone if the name already contains "consolidated" (any case), so applying it
    twice, or to a file the team already named that way, changes nothing."""
    name = Path(filename).name
    if "consolidated" in name.lower():
        return name
    p = Path(name)
    return f"{p.stem}{SUFFIX}{p.suffix}"


def _free_path(path: Path) -> Path:
    """`path`, or `<stem>_v2`, `_v3`… if that name is taken (same scheme as uploads)."""
    if not path.exists():
        return path
    n = 2
    while (path.parent / f"{path.stem}_v{n}{path.suffix}").exists():
        n += 1
    return path.parent / f"{path.stem}_v{n}{path.suffix}"


def rename_existing_consolidated_files(db: Session) -> list[str]:
    """Bring already-uploaded consolidated Excel files in line with the naming rule:
    rename the file on disk, then update the attachment record and the run's sheet to
    match. Safe to run on every startup — files that already comply, or are missing from
    disk, are skipped."""
    rows = (
        db.query(models.Attachment)
        .join(models.HistoryEntry, models.Attachment.history_entry_id == models.HistoryEntry.id)
        .filter(models.HistoryEntry.stage_id == CONSOLIDATED_STAGE)
        .all()
    )
    renamed = []
    for att in rows:
        if not looks_like_excel(att.filename) or "consolidated" in att.filename.lower():
            continue
        old_path = Path(att.stored_path)
        if not old_path.is_file():
            continue
        new_name = with_consolidated_suffix(att.filename)
        new_path = _free_path(old_path.with_name(new_name))
        try:
            old_path.rename(new_path)
        except OSError:
            continue
        old_name = att.filename
        att.filename = new_path.name
        att.stored_path = str(new_path)
        for sheet in db.query(models.Sheet).filter(models.Sheet.source_attachment_id == att.id):
            sheet.source_filename = new_path.name
        renamed.append(f"{old_name} -> {new_path.name}")
    if renamed:
        db.commit()
    return renamed
