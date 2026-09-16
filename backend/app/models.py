import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Boolean, DateTime, ForeignKey, Text, BigInteger, Integer
)
from sqlalchemy.orm import relationship

from .database import Base


def _uuid():
    return uuid.uuid4().hex


def now_utc():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    username = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # wetlab | primary_team | primary_head | bioinfo_head | admin
    password_hash = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)


class Run(Base):
    __tablename__ = "runs"

    id = Column(String, primary_key=True, default=_uuid)
    run_number = Column(String, unique=True, index=True, nullable=False)
    current_stage = Column(String, nullable=False)
    status = Column(String, nullable=False, default="in_progress")  # in_progress | completed
    created_by_id = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    created_by = relationship("User")
    history = relationship("HistoryEntry", back_populates="run", order_by="HistoryEntry.created_at",
                            cascade="all, delete-orphan")


class HistoryEntry(Base):
    __tablename__ = "history_entries"

    id = Column(String, primary_key=True, default=_uuid)
    run_id = Column(String, ForeignKey("runs.id"), nullable=False)
    stage_id = Column(String, nullable=False)
    action = Column(String, nullable=False)  # completed | approved | rejected
    note = Column(Text, nullable=True)
    actor_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    actor_name = Column(String, nullable=False)
    actor_role = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    run = relationship("Run", back_populates="history")
    actor = relationship("User")
    attachments = relationship("Attachment", back_populates="history_entry", cascade="all, delete-orphan")


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(String, primary_key=True, default=_uuid)
    history_entry_id = Column(String, ForeignKey("history_entries.id"), nullable=False)
    filename = Column(String, nullable=False)
    stored_path = Column(String, nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    content_type = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    history_entry = relationship("HistoryEntry", back_populates="attachments")


class Sheet(Base):
    """The live, editable data behind a run's consolidated Excel. One per run — created
    when Primary Team first uploads the consolidated Excel, refreshed (cell values only)
    on every re-upload after a send-back. Notes, flags and QC decisions are keyed by
    row/column and survive a re-upload even though the cell data itself is replaced."""
    __tablename__ = "sheets"

    id = Column(String, primary_key=True, default=_uuid)
    run_id = Column(String, ForeignKey("runs.id"), unique=True, nullable=False)
    columns_json = Column(Text, nullable=False)  # JSON list of original column names, in order
    source_filename = Column(String, nullable=True)
    # Which tab of the uploaded workbook this data came from, and which attachment that
    # was — a workbook commonly has several sheets (e.g. Picard HS-metrics exports), so
    # the wrong one can be picked by default; both let the UI offer "use a different tab".
    source_sheet_name = Column(String, nullable=True)
    source_attachment_id = Column(String, ForeignKey("attachments.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    run = relationship("Run")
    rows = relationship("SheetRow", back_populates="sheet", order_by="SheetRow.row_index",
                         cascade="all, delete-orphan")
    annotations = relationship("SheetAnnotation", back_populates="sheet", cascade="all, delete-orphan")


class SheetRow(Base):
    __tablename__ = "sheet_rows"

    id = Column(String, primary_key=True, default=_uuid)
    sheet_id = Column(String, ForeignKey("sheets.id"), nullable=False)
    row_index = Column(Integer, nullable=False)
    cells_json = Column(Text, nullable=False)  # JSON object: {column_name: value}
    qc_pass = Column(String, nullable=False, default="Pass")      # "Pass" | "Fail" — Primary Head only
    resequencing = Column(String, nullable=False, default="No")   # "No" | "Yes" — Primary Head only
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    sheet = relationship("Sheet", back_populates="rows")


class SheetAnnotation(Base):
    """A note (from Primary Team) or an error flag (from Primary Head) attached to a
    cell, a whole row, or a whole column of the consolidated Excel."""
    __tablename__ = "sheet_annotations"

    id = Column(String, primary_key=True, default=_uuid)
    sheet_id = Column(String, ForeignKey("sheets.id"), nullable=False)
    scope = Column(String, nullable=False)          # cell | row | column
    row_index = Column(Integer, nullable=True)       # set for scope in (cell, row)
    column_name = Column(String, nullable=True)      # set for scope in (cell, column)
    kind = Column(String, nullable=False)            # note | flag
    text = Column(Text, nullable=False)
    author_name = Column(String, nullable=False)
    author_role = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    sheet = relationship("Sheet", back_populates="annotations")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=_uuid)
    run_id = Column(String, ForeignKey("runs.id"), nullable=False)
    role = Column(String, nullable=False)
    text = Column(String, nullable=False)
    read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    run = relationship("Run")
