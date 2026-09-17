from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    username: str
    full_name: str
    role: str
    is_active: bool = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6)


class CreateUserRequest(BaseModel):
    username: str
    full_name: str
    role: str
    password: str = Field(min_length=6)


class CreateRunRequest(BaseModel):
    run_number: str = Field(min_length=1, max_length=64)


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    filename: str
    size_bytes: int
    content_type: Optional[str] = None


class HistoryEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    stage_id: str
    action: str
    note: Optional[str] = None
    actor_name: str
    actor_role: str
    created_at: datetime
    attachments: List[AttachmentOut] = []


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_number: str
    current_stage: str
    status: str
    created_at: datetime
    updated_at: datetime

    file_count: int = 0
    # Send-back tracking: how often a reviewer asked for changes, and whether the
    # team has since re-uploaded the file that was rejected.
    rejection_count: int = 0
    awaiting_reupload: bool = False
    last_rejection_note: Optional[str] = None
    last_rejection_by: Optional[str] = None
    last_rejection_role: Optional[str] = None
    last_rejection_at: Optional[datetime] = None
    last_activity_by: Optional[str] = None
    has_resequencing: bool = False  # any sample in this run's consolidated Excel marked Re-Sequencing = Yes


class FileOut(BaseModel):
    """A stored upload, flattened with the run/step it belongs to."""
    id: str
    run_number: str
    stage_id: str
    filename: str
    size_bytes: int
    content_type: Optional[str] = None
    uploaded_by: str
    uploaded_by_role: str
    created_at: datetime


class RunDetailOut(RunOut):
    history: List[HistoryEntryOut] = []


class SheetAnnotationOut(BaseModel):
    id: str
    scope: str  # cell | row | column
    row_index: Optional[int] = None
    column: Optional[str] = None
    kind: str  # note | flag
    text: str
    author_name: str
    author_role: str
    can_delete: bool = False
    created_at: datetime


class SheetRowOut(BaseModel):
    row_index: int
    cells: Dict[str, Any]
    qc_pass: str
    resequencing: str


class SheetOut(BaseModel):
    run_number: str
    columns: List[str]
    rows: List[SheetRowOut]
    annotations: List[SheetAnnotationOut]
    can_edit_cells: bool  # true only for Primary Team
    can_edit_qc: bool     # true only for Primary Team Head
    can_annotate: bool    # true for Primary Team (notes) or Primary Team Head (flags)
    updated_at: datetime

    # A workbook can have several tabs (Picard HS-metrics exports ship 4 side by side) —
    # this is which one is currently being used as the data, and what else is available,
    # so a wrong guess can be corrected instead of silently producing nonsense columns.
    source_sheet_name: Optional[str] = None
    available_sheet_names: List[str] = []
    source_attachment_id: Optional[str] = None


class SheetReingestRequest(BaseModel):
    sheet_name: str = Field(min_length=1)


class SheetCellEdit(BaseModel):
    row_index: int
    column: str
    value: str = ""


class SheetRowQCEdit(BaseModel):
    row_index: int
    qc_pass: Optional[str] = None
    resequencing: Optional[str] = None


class SheetAnnotationCreate(BaseModel):
    scope: str  # cell | row | column
    row_index: Optional[int] = None
    column: Optional[str] = None
    text: str = Field(min_length=1)


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    role: str
    text: str
    kind: str = "update"
    read: bool
    created_at: datetime


class MonthlyReportRunOut(BaseModel):
    run_number: str
    run_label: str
    test: str = ""
    # None when the consolidated Excel (or its "summary" tab) isn't there yet.
    number_of_samples: Optional[float] = None
    rawdata_backup_size: str = ""
    rawdata_backup_drive: str = ""
    data_received: datetime
    shared_to_exome_group: str = ""
    itdose: str = ""
    output_backup_drive: str = ""
    coverage: str = ""
    done_by: str = ""
    has_summary: bool = False


class MonthlyReportTotalsOut(BaseModel):
    number_of_samples: Optional[float] = None
    rawdata_backup_size: Optional[str] = None


class MonthlyReportOut(BaseModel):
    year: int
    month: int
    runs: List[MonthlyReportRunOut]
    totals: MonthlyReportTotalsOut


class MonthlyReportCellEdit(BaseModel):
    field: str
    value: str = ""
