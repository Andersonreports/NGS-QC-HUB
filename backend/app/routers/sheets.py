import json
from io import BytesIO
from pathlib import Path

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..sheet_ingest import ingest_consolidated_excel, list_sheet_names, looks_like_excel
from ..workflow import ROLES

router = APIRouter(prefix="/api/runs/{run_number}/sheet", tags=["sheets"])

QC_PASS_VALUES = {"Pass", "Fail"}
RESEQUENCING_VALUES = {"No", "Yes"}


def _sheet_or_404(db: Session, run_number: str) -> models.Sheet:
    sheet = (
        db.query(models.Sheet)
        .join(models.Run, models.Sheet.run_id == models.Run.id)
        .filter(models.Run.run_number == run_number)
        .first()
    )
    if sheet:
        return sheet

    # Sheets were introduced after some consolidated workbooks had already been
    # uploaded.  Those attachments are valid, but do not yet have their editable
    # Sheet record.  Build it the first time the workbook is opened rather than
    # incorrectly telling the user that nothing was uploaded.
    run = db.query(models.Run).filter(models.Run.run_number == run_number).first()
    attachments = []
    if run:
        attachments = (
            db.query(models.Attachment)
            .join(models.HistoryEntry, models.Attachment.history_entry_id == models.HistoryEntry.id)
            .filter(
                models.HistoryEntry.run_id == run.id,
                models.HistoryEntry.stage_id == "excel_uploaded",
            )
            .order_by(models.Attachment.created_at.desc())
            .all()
        )

    attachment = next(
        (
            item for item in attachments
            if looks_like_excel(item.filename) and Path(item.stored_path).is_file()
        ),
        None,
    )
    if attachment:
        sheet = ingest_consolidated_excel(db, run, attachment.stored_path, attachment.filename, attachment_id=attachment.id)
        db.commit()
        db.refresh(sheet)
        return sheet

    raise HTTPException(status.HTTP_404_NOT_FOUND, "No consolidated Excel has been uploaded for this run yet")


def _sheet_out(sheet: models.Sheet, user: models.User, db: Session) -> schemas.SheetOut:
    columns = json.loads(sheet.columns_json)
    rows = [
        schemas.SheetRowOut(
            row_index=r.row_index, cells=json.loads(r.cells_json),
            qc_pass=r.qc_pass, resequencing=r.resequencing,
        )
        for r in sorted(sheet.rows, key=lambda r: r.row_index)
    ]
    annotations = [
        schemas.SheetAnnotationOut(
            id=a.id, scope=a.scope, row_index=a.row_index, column=a.column_name,
            kind=a.kind, text=a.text, author_name=a.author_name, author_role=a.author_role,
            can_delete=(a.author_role == user.role and a.author_name == user.full_name),
            created_at=a.created_at,
        )
        for a in sorted(sheet.annotations, key=lambda a: a.created_at)
    ]
    # QC decisions are reviewer findings too. Surface them in the same shared flags
    # feed as written annotations, without storing duplicate rows that could become
    # stale when QC is changed back to Pass / No.
    for row in sorted(sheet.rows, key=lambda item: item.row_index):
        if row.qc_pass == "Fail":
            annotations.append(schemas.SheetAnnotationOut(
                id=f"qc-fail-{row.id}", scope="row", row_index=row.row_index, column="QC Pass",
                kind="flag", text="QC failed", author_name="Primary Team Head", author_role="primary_head",
                can_delete=False, created_at=row.updated_at,
            ))
        if row.resequencing == "Yes":
            annotations.append(schemas.SheetAnnotationOut(
                id=f"resequencing-{row.id}", scope="row", row_index=row.row_index, column="Re-Sequencing",
                kind="flag", text="Re-Sequencing requested", author_name="Primary Team Head", author_role="primary_head",
                can_delete=False, created_at=row.updated_at,
            ))
    annotations.sort(key=lambda annotation: annotation.created_at)

    available_sheet_names = []
    if sheet.source_attachment_id:
        attachment = db.get(models.Attachment, sheet.source_attachment_id)
        if attachment and Path(attachment.stored_path).is_file():
            try:
                available_sheet_names = list_sheet_names(attachment.stored_path)
            except Exception:
                # A tab listing is a nice-to-have; never let a corrupt/locked file
                # break the sheet the user is actually here to see.
                available_sheet_names = []

    return schemas.SheetOut(
        run_number=sheet.run.run_number, columns=columns, rows=rows, annotations=annotations,
        can_edit_cells=(user.role == "primary_team"), can_edit_qc=(user.role == "primary_head"),
        can_annotate=(user.role in ("primary_team", "primary_head")),
        updated_at=sheet.updated_at,
        source_sheet_name=sheet.source_sheet_name,
        available_sheet_names=available_sheet_names,
        source_attachment_id=sheet.source_attachment_id,
    )


@router.get("", response_model=schemas.SheetOut)
def get_sheet(run_number: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _sheet_out(_sheet_or_404(db, run_number), user, db)


@router.patch("/cell", response_model=schemas.SheetOut)
def edit_cell(
    run_number: str, payload: schemas.SheetCellEdit,
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    if user.role != "primary_team":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the Primary Team can edit cell values")
    sheet = _sheet_or_404(db, run_number)
    row = next((r for r in sheet.rows if r.row_index == payload.row_index), None)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That row no longer exists")
    columns = json.loads(sheet.columns_json)
    if payload.column not in columns:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown column '{payload.column}'")

    cells = json.loads(row.cells_json)
    cells[payload.column] = payload.value
    row.cells_json = json.dumps(cells)
    sheet.updated_at = models.now_utc()
    db.commit()
    db.refresh(sheet)
    return _sheet_out(sheet, user, db)


def _sample_label(sheet: models.Sheet, row: models.SheetRow) -> str | None:
    """Best guess at which sample a row is — whichever column name mentions
    "sample", if the ingested tab has one at all."""
    columns = json.loads(sheet.columns_json)
    cells = json.loads(row.cells_json)
    for col in columns:
        if "sample" in col.lower():
            value = cells.get(col)
            if value:
                return str(value)
    return None


def _notify_qc_fail(db: Session, sheet: models.Sheet, row: models.SheetRow) -> None:
    """Dashboard notification only — every role, not just Bioinfo Head, since a
    QC fail is relevant to the whole team. Tagged with its own `kind` so the
    frontend can call it out distinctly (red) from routine stage updates."""
    run = sheet.run
    sample_label = _sample_label(sheet, row)
    text = f"Run {run.run_number}: QC fail recorded" + (f" for sample {sample_label}" if sample_label else "") + "."
    for role in ROLES:
        db.add(models.Notification(run_id=run.id, role=role, text=text, kind="qc_fail"))
    db.commit()


@router.patch("/qc", response_model=schemas.SheetOut)
def edit_qc(
    run_number: str, payload: schemas.SheetRowQCEdit,
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    if user.role != "primary_head":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the Primary Team Head can set QC Pass / Re-Sequencing")
    sheet = _sheet_or_404(db, run_number)
    row = next((r for r in sheet.rows if r.row_index == payload.row_index), None)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That row no longer exists")

    newly_failed = False
    if payload.qc_pass is not None:
        if payload.qc_pass not in QC_PASS_VALUES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"qc_pass must be one of {sorted(QC_PASS_VALUES)}")
        newly_failed = payload.qc_pass == "Fail" and row.qc_pass != "Fail"
        row.qc_pass = payload.qc_pass
    if payload.resequencing is not None:
        if payload.resequencing not in RESEQUENCING_VALUES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"resequencing must be one of {sorted(RESEQUENCING_VALUES)}")
        row.resequencing = payload.resequencing

    sheet.updated_at = models.now_utc()
    db.commit()
    db.refresh(sheet)

    if newly_failed:
        _notify_qc_fail(db, sheet, row)

    return _sheet_out(sheet, user, db)


@router.post("/annotations", response_model=schemas.SheetOut)
def add_annotation(
    run_number: str, payload: schemas.SheetAnnotationCreate,
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    if user.role not in ("primary_team", "primary_head"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the Primary Team or Primary Team Head can annotate")
    if payload.scope not in ("cell", "row", "column"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "scope must be 'cell', 'row' or 'column'")
    if payload.scope in ("cell", "row") and payload.row_index is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "row_index is required for this scope")
    if payload.scope in ("cell", "column") and not payload.column:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "column is required for this scope")

    sheet = _sheet_or_404(db, run_number)
    if payload.column and payload.column not in json.loads(sheet.columns_json):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown column '{payload.column}'")

    db.add(models.SheetAnnotation(
        sheet_id=sheet.id, scope=payload.scope, row_index=payload.row_index, column_name=payload.column,
        kind="note" if user.role == "primary_team" else "flag", text=payload.text.strip(),
        author_name=user.full_name, author_role=user.role,
    ))
    db.commit()
    db.refresh(sheet)
    return _sheet_out(sheet, user, db)


@router.delete("/annotations/{annotation_id}", response_model=schemas.SheetOut)
def delete_annotation(
    run_number: str, annotation_id: str,
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    """Allow an author to remove their own accidental note or flag."""
    sheet = _sheet_or_404(db, run_number)
    annotation = (
        db.query(models.SheetAnnotation)
        .filter(models.SheetAnnotation.id == annotation_id, models.SheetAnnotation.sheet_id == sheet.id)
        .first()
    )
    if not annotation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That note or flag no longer exists")
    if annotation.author_role != user.role or annotation.author_name != user.full_name:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who added a note or flag can remove it")

    db.delete(annotation)
    sheet.updated_at = models.now_utc()
    db.commit()
    db.refresh(sheet)
    return _sheet_out(sheet, user, db)


@router.post("/reingest", response_model=schemas.SheetOut)
def reingest_sheet(
    run_number: str, payload: schemas.SheetReingestRequest,
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    """Re-parse the same uploaded workbook using a different tab — for when the wrong
    sheet was picked by default (a workbook's `active` tab isn't always the one with the
    actual data; Picard-style QC exports commonly ship several tabs side by side).
    Re-reads the *original* attachment, so nothing needs to be re-uploaded. QC decisions
    and annotations are preserved by row position, same as any other re-ingest."""
    if user.role != "primary_team":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the Primary Team can choose a different sheet tab")
    sheet = _sheet_or_404(db, run_number)
    if not sheet.source_attachment_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The original file for this sheet isn't available to re-read")
    attachment = db.get(models.Attachment, sheet.source_attachment_id)
    if not attachment or not Path(attachment.stored_path).is_file():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The original file for this sheet is no longer on disk")

    run = db.get(models.Run, sheet.run_id)
    ingest_consolidated_excel(
        db, run, attachment.stored_path, attachment.filename,
        sheet_name=payload.sheet_name, attachment_id=attachment.id,
    )
    db.commit()
    db.refresh(sheet)
    return _sheet_out(sheet, user, db)


@router.get("/export.xlsx")
def export_sheet(run_number: str, db: Session = Depends(get_db), _user: models.User = Depends(get_current_user)):
    """A fresh .xlsx reflecting the live edited data plus the QC Pass / Re-Sequencing
    columns — the real deliverable, generated on demand rather than stored."""
    sheet = _sheet_or_404(db, run_number)
    columns = json.loads(sheet.columns_json)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Consolidated"
    ws.append([*columns, "QC Pass", "Re-Sequencing"])
    for r in sorted(sheet.rows, key=lambda r: r.row_index):
        cells = json.loads(r.cells_json)
        ws.append([cells.get(c, "") for c in columns] + [r.qc_pass, r.resequencing])

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"{run_number}_Consolidated.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
