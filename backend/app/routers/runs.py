import uuid
from collections import defaultdict
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Form, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..config import UPLOADS_DIR, MAX_UPLOAD_BYTES
from ..database import get_db
from ..deps import get_current_user, require_role
from ..workflow import (
    STAGE_BY_ID, STAGE_INDEX, ROLES, FIRST_STAGE_ID, REVIEW_STAGE_IDS, FILE_REQUIRED_STAGES, next_stage_after,
    actor_name_for, can_see_stage, visible_history,
)
from ..sheet_ingest import ingest_consolidated_excel, looks_like_excel

router = APIRouter(prefix="/api/runs", tags=["runs"])

ROLE_LABELS = {
    "wetlab": "Wet Lab",
    "primary_team": "Primary Team",
    "primary_head": "Primary Team Head",
    "bioinfo_head": "Bioinfo Team Head",
}


def _run_or_404(db: Session, run_number: str) -> models.Run:
    run = (
        db.query(models.Run)
        .options(joinedload(models.Run.history).joinedload(models.HistoryEntry.attachments))
        .filter(models.Run.run_number == run_number)
        .first()
    )
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No run found with run number '{run_number}'")
    return run


def _unique_path(directory: Path, filename: str) -> Path:
    """Keep the uploader's filename so each run folder reads like a plain drop folder;
    only add a counter if that exact name is already taken (e.g. a re-upload after a send-back)."""
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem, suffix = candidate.stem, candidate.suffix
    n = 2
    while (directory / f"{stem}_v{n}{suffix}").exists():
        n += 1
    return directory / f"{stem}_v{n}{suffix}"


def _push_notification(db: Session, run: models.Run, role: str, text: str):
    if not role:
        return
    db.add(models.Notification(run_id=run.id, role=role, text=text))


def _push_stage_notifications(db: Session, run: models.Run, stage_id: str, sent_back: bool = False):
    """Keep every workflow role informed, while making the action owner clear."""
    stage = STAGE_BY_ID[stage_id]
    if stage_id == "completed":
        for role in ROLES:
            _push_notification(
                db, run, role,
                f"Run {run.run_number}: Samples Approved - move to tertiary team.",
            )
        return

    owner = stage["role"]
    owner_title = stage["title"]
    for role in ROLES:
        if role == owner:
            suffix = " A revision was requested." if sent_back else ""
            text = f"Run {run.run_number}: action needed — {owner_title}.{suffix}"
        else:
            text = f"Run {run.run_number} is at {owner_title} — awaiting {ROLE_LABELS[owner]}."
        _push_notification(db, run, role, text)


def _send_back_state(history: list, run_status: str) -> dict:
    """Send-back tracking shared by the list and detail responses: how often a reviewer
    asked for changes, and whether the file has been re-uploaded since the last one."""
    rejections = [h for h in history if h.action == "rejected"]
    state = {
        "rejection_count": len(rejections),
        "last_activity_by": history[-1].actor_name if history else None,
    }
    if rejections:
        last = rejections[-1]
        reuploaded = any(
            h.created_at > last.created_at
            and h.action == "completed"
            and h.stage_id in FILE_REQUIRED_STAGES
            for h in history
        )
        state.update(
            awaiting_reupload=(not reuploaded and run_status != "completed"),
            last_rejection_note=last.note,
            last_rejection_by=last.actor_name,
            last_rejection_role=last.actor_role,
            last_rejection_at=last.created_at,
        )
    return state


def _detail_out(run: models.Run, viewer_role: str) -> schemas.RunDetailOut:
    """Builds the response for one run, scoped to what `viewer_role` is allowed to see —
    hidden-stage history entries (and therefore their files) are dropped entirely rather
    than merely hidden in the UI, so there's nothing to find by calling the API directly."""
    full_history = sorted(run.history, key=lambda h: h.created_at)
    visible = visible_history(full_history, viewer_role)
    extra = _send_back_state(full_history, run.status)  # send-back state uses the true history
    extra["file_count"] = sum(len(h.attachments) for h in visible)
    out = schemas.RunDetailOut.model_validate(run).model_copy(update=extra)
    out.history = [schemas.HistoryEntryOut.model_validate(h) for h in visible]
    return out


@router.get("", response_model=List[schemas.RunOut])
def list_runs(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    runs = db.query(models.Run).order_by(models.Run.updated_at.desc()).all()

    history_by_run: dict[str, list[models.HistoryEntry]] = defaultdict(list)
    for entry in db.query(models.HistoryEntry).options(joinedload(models.HistoryEntry.attachments)).order_by(
        models.HistoryEntry.created_at
    ).all():
        history_by_run[entry.run_id].append(entry)

    # Which runs have at least one sample marked Re-Sequencing = Yes, so the run list
    # can filter to "has gone for re-sequencing" without opening every sheet.
    resequencing_run_ids = {
        run_id
        for (run_id,) in db.query(models.Sheet.run_id)
        .join(models.SheetRow, models.SheetRow.sheet_id == models.Sheet.id)
        .filter(models.SheetRow.resequencing == "Yes")
        .distinct()
        .all()
    }

    out = []
    for run in runs:
        full_history = history_by_run.get(run.id, [])
        visible = visible_history(full_history, user.role)
        extra = _send_back_state(full_history, run.status)  # send-back state uses the true history
        extra["file_count"] = sum(len(h.attachments) for h in visible)
        extra["has_resequencing"] = run.id in resequencing_run_ids
        out.append(schemas.RunOut.model_validate(run).model_copy(update=extra))
    return out


@router.get("/files/all", response_model=List[schemas.FileOut])
def list_all_files(
    run_number: Optional[str] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Every stored upload this viewer is allowed to see, newest first — optionally
    narrowed to one run."""
    q = (
        db.query(models.Attachment, models.HistoryEntry, models.Run)
        .join(models.HistoryEntry, models.Attachment.history_entry_id == models.HistoryEntry.id)
        .join(models.Run, models.HistoryEntry.run_id == models.Run.id)
    )
    if run_number:
        q = q.filter(models.Run.run_number == run_number.strip())
    rows = q.order_by(models.Attachment.created_at.desc()).all()
    return [
        schemas.FileOut(
            id=att.id,
            run_number=run.run_number,
            stage_id=entry.stage_id,
            filename=att.filename,
            size_bytes=att.size_bytes,
            content_type=att.content_type,
            uploaded_by=entry.actor_name,
            uploaded_by_role=entry.actor_role,
            created_at=att.created_at,
        )
        for att, entry, run in rows
        if can_see_stage(entry.stage_id, user.role)
    ]


@router.post("", response_model=schemas.RunDetailOut)
def create_run(
    payload: schemas.CreateRunRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_role("wetlab")),
):
    run_number = payload.run_number.strip()
    if db.query(models.Run).filter(models.Run.run_number == run_number).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Run number '{run_number}' already exists")

    run = models.Run(
        run_number=run_number,
        current_stage="drive_checked",
        status="in_progress",
        created_by_id=user.id,
    )
    db.add(run)
    db.flush()

    for stage_id in (FIRST_STAGE_ID, "dashboard_updated"):
        db.add(models.HistoryEntry(
            run_id=run.id, stage_id=stage_id, action="completed",
            actor_user_id=user.id, actor_name=user.full_name, actor_role=user.role,
        ))
    # "Notification Received" is a passive, system-generated checkpoint — Primary Team
    # doesn't take a separate action for it, so it's auto-marked done and the run lands
    # directly on the actionable "Validate & Backup" (CSV/Excel upload) stage.
    db.add(models.HistoryEntry(
        run_id=run.id, stage_id="notified", action="completed",
        actor_name="System", actor_role="primary_team",
    ))

    _push_stage_notifications(db, run, run.current_stage)
    db.commit()
    return _detail_out(_run_or_404(db, run.run_number), user.role)


@router.get("/{run_number}", response_model=schemas.RunDetailOut)
def get_run(run_number: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _detail_out(_run_or_404(db, run_number), user.role)


@router.post("/{run_number}/advance", response_model=schemas.RunDetailOut)
async def advance_run(
    run_number: str,
    note: Optional[str] = Form(None),
    action: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    run = _run_or_404(db, run_number)
    if run.status == "completed":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This run is already completed")

    stage = STAGE_BY_ID[run.current_stage]
    if stage["role"] != user.role:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"This step belongs to {stage['role']}, not {user.role}")

    is_review = run.current_stage in REVIEW_STAGE_IDS
    if is_review:
        if action not in ("approved", "rejected"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "action must be 'approved' or 'rejected'")
        # Primary Team Head identifies corrections directly as red flags in the
        # consolidated Excel, so an additional free-text note is optional there.
        # Other reviewers do not have that flagging surface and must explain a
        # send-back in their note.
        if action == "rejected" and user.role != "primary_head" and not (note and note.strip()):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A note is required when requesting changes")
    else:
        action = "completed"
        if run.current_stage in FILE_REQUIRED_STAGES and len(files) == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one attachment is required for this step")

    # Excel/PDF uploads return here only after a reviewer has requested changes.
    # Keep the original history entry (and therefore its timestamp), but replace its
    # attachment with the corrected document the team is submitting now.
    is_reupload = (
        stage["id"] in {"excel_uploaded", "pdf_uploaded"}
        and db.query(models.HistoryEntry)
        .filter(
            models.HistoryEntry.run_id == run.id,
            models.HistoryEntry.stage_id == stage["id"],
            models.HistoryEntry.action == "completed",
        )
        .first()
        is not None
    )
    reupload_note = None
    if is_reupload:
        document = "Consolidated Excel" if stage["id"] == "excel_uploaded" else "Consolidated PDF"
        reupload_note = f"{document} has been reuploaded after requested changes."
        if note and note.strip():
            reupload_note = f"{reupload_note} {note.strip()}"

    entry = models.HistoryEntry(
        run_id=run.id, stage_id=run.current_stage, action=action,
        note=reupload_note if is_reupload else (note.strip() if note else None),
        actor_user_id=user.id, actor_name=actor_name_for(run.current_stage, user.full_name), actor_role=user.role,
    )
    db.add(entry)
    db.flush()

    replaced_paths = []
    if is_reupload:
        replaced_attachments = (
            db.query(models.Attachment)
            .join(models.HistoryEntry, models.Attachment.history_entry_id == models.HistoryEntry.id)
            .filter(
                models.HistoryEntry.run_id == run.id,
                models.HistoryEntry.stage_id == stage["id"],
                models.HistoryEntry.id != entry.id,
            )
            .all()
        )
        replaced_paths = [Path(attachment.stored_path) for attachment in replaced_attachments]
        for attachment in replaced_attachments:
            db.delete(attachment)

    run_dir = UPLOADS_DIR / run.run_number
    run_dir.mkdir(parents=True, exist_ok=True)
    saved = []  # (filename, stored_path, attachment_id) — kept so the consolidated Excel can be ingested below
    for f in files:
        contents = await f.read()
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{f.filename} exceeds the maximum upload size")
        dest = _unique_path(run_dir, Path(f.filename).name)
        with open(dest, "wb") as out:
            out.write(contents)
        attachment_id = uuid.uuid4().hex
        db.add(models.Attachment(
            id=attachment_id, history_entry_id=entry.id, filename=f.filename, stored_path=str(dest),
            size_bytes=len(contents), content_type=f.content_type,
        ))
        saved.append((f.filename, dest, attachment_id))

    if stage["id"] == "excel_uploaded":
        excel_file = next((item for item in saved if looks_like_excel(item[0])), None)
        if excel_file:
            name, dest, attachment_id = excel_file
            ingest_consolidated_excel(db, run, str(dest), name, attachment_id=attachment_id)

    next_stage_id = next_stage_after(run.current_stage, action)
    run.current_stage = next_stage_id
    run.status = "completed" if next_stage_id == "completed" else "in_progress"

    _push_stage_notifications(db, run, next_stage_id, sent_back=(action == "rejected"))

    db.commit()
    for path in replaced_paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # The new attachment and complete audit trail are already committed. A
            # leftover orphan on disk is harmless and should not fail the re-upload.
            pass
    return _detail_out(_run_or_404(db, run.run_number), user.role)


@router.get("/{run_number}/files/{attachment_id}")
def download_attachment(
    run_number: str, attachment_id: str,
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    row = (
        db.query(models.Attachment, models.HistoryEntry)
        .join(models.HistoryEntry, models.Attachment.history_entry_id == models.HistoryEntry.id)
        .join(models.Run, models.HistoryEntry.run_id == models.Run.id)
        .filter(models.Attachment.id == attachment_id, models.Run.run_number == run_number)
        .first()
    )
    # A hidden-stage file 404s the same as one that doesn't exist — the API shouldn't
    # reveal it's there at all to a role that isn't meant to see that step.
    if not row or not can_see_stage(row[1].stage_id, user.role):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    attachment, _entry = row
    if not Path(attachment.stored_path).exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return FileResponse(attachment.stored_path, filename=attachment.filename, media_type=attachment.content_type)


# Removing the consolidated Excel or PDF invalidates whatever review happened after
# it — that review was of a file that no longer exists — so the run rolls back to
# that upload step and whoever already approved is told their approval no longer holds.
ROLLBACK_STAGES = {"excel_uploaded", "pdf_uploaded"}
ROLLBACK_NOTIFY_ROLES = {
    "excel_uploaded": ["primary_head", "wetlab", "bioinfo_head"],
    "pdf_uploaded": ["wetlab"],
}


@router.delete("/{run_number}/files/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    run_number: str, attachment_id: str,
    db: Session = Depends(get_db), user: models.User = Depends(require_role("primary_team")),
):
    """Remove an uploaded file — Primary Team only, since they're the only role that
    ever uploads one. If it was the consolidated Excel or PDF and the run has since
    moved on past that step (including all the way to completed), the run is rolled
    back to that upload step so it goes through the approvals again once re-uploaded.
    The removal itself is recorded in history — with its own timestamp — and anyone
    whose approval no longer holds is notified, naming who removed it."""
    row = (
        db.query(models.Attachment)
        .join(models.HistoryEntry, models.Attachment.history_entry_id == models.HistoryEntry.id)
        .join(models.Run, models.HistoryEntry.run_id == models.Run.id)
        .filter(models.Attachment.id == attachment_id, models.Run.run_number == run_number)
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")

    stored_path = Path(row.stored_path)
    entry = row.history_entry
    run = entry.run
    stage_id = entry.stage_id
    filename = row.filename

    db.delete(row)
    db.flush()

    if stage_id in ROLLBACK_STAGES:
        latest_entry_id = (
            db.query(models.HistoryEntry.id)
            .filter(models.HistoryEntry.run_id == run.id, models.HistoryEntry.stage_id == stage_id)
            .order_by(models.HistoryEntry.created_at.desc())
            .limit(1)
            .scalar()
        )
        remaining = (
            db.query(models.Attachment)
            .filter(models.Attachment.history_entry_id == entry.id)
            .count()
        )
        # Only the latest upload for this step matters — an older, already-superseded
        # one being emptied out shouldn't undo progress made on top of the newer file.
        is_latest_and_now_empty = latest_entry_id == entry.id and remaining == 0
        already_moved_on = STAGE_INDEX[run.current_stage] > STAGE_INDEX[stage_id]

        if is_latest_and_now_empty and already_moved_on:
            run.current_stage = stage_id
            run.status = "in_progress"
            db.add(models.HistoryEntry(
                run_id=run.id,
                stage_id=stage_id,
                action="reset",
                note=f"{filename} was removed by {user.full_name} — awaiting re-upload.",
                actor_user_id=user.id,
                actor_name=user.full_name,
                actor_role=user.role,
            ))
            for role in ROLLBACK_NOTIFY_ROLES.get(stage_id, []):
                _push_notification(
                    db, run, role,
                    f"Run {run.run_number}: {user.full_name} removed {filename} — "
                    f"your approval no longer holds. Primary Team must re-upload it "
                    f"before this can be reviewed again.",
                )
            _push_notification(
                db, run, "primary_team",
                f"Run {run.run_number}: {filename} was removed — re-upload it to continue.",
            )

    db.commit()
    if stored_path.exists():
        stored_path.unlink()
