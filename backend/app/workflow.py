"""Single source of truth for the Wet Lab -> Bioinfo data approval pipeline.

Maps 1:1 onto the 12-step flow diagram. Steps 5 and 9 of that diagram ("prepares
consolidated Excel/PDF") are work done outside the dashboard, so they are not separate
dashboard actions — preparing and uploading are one action here. `step` is the label
from the diagram; `id` is the internal stage key.

  diagram step        stage id               who
  1  raw data -> drive    raw_data_placed        Wet Lab
  2  dashboard updated    dashboard_updated      Wet Lab
  3  notification         notified               Primary Team (automatic)
  4  raw CSV + Excel      drive_checked          Primary Team
  5-6 consolidated Excel  excel_uploaded         Primary Team
  7  head approves        primary_head_review    Primary Team Head
  7  QC approves          wetlab_qc_review       Wet Lab
  8  bioinfo sign-off     bioinfo_review         Bioinfo Team Head
  9-10 consolidated PDF   pdf_uploaded           Primary Team
  11 PDF approval         wetlab_final_review    Wet Lab
  12 status + notes       completed              —
"""

ROLES = ["wetlab", "primary_team", "primary_head", "bioinfo_head"]

STAGES = [
    {"id": "raw_data_placed", "step": "1", "role": "wetlab",
     "title": "Raw data on common drive",
     "desc": "FastQ, CSV, Excel and Md5sum files placed on the common drive."},
    {"id": "dashboard_updated", "step": "2", "role": "wetlab",
     "title": "Marked as transferred",
     "desc": "Wet Lab marked the run as transferred so the Primary Team is notified."},
    {"id": "notified", "step": "3", "role": "primary_team",
     "title": "Primary Team notified",
     "desc": "Alert raised in the dashboard that new run data is ready on the common drive."},
    {"id": "drive_checked", "step": "4", "role": "primary_team",
     "title": "Raw CSV & Excel upload",
     "desc": "Raw data checked on the common drive; CSV and Excel uploaded to the dashboard as backup."},
    {"id": "excel_uploaded", "step": "5-6", "role": "primary_team",
     "title": "Consolidated Excel upload",
     "desc": "Consolidated Excel (raw data plus essential details and analysis) uploaded for review and approvals."},
    {"id": "primary_head_review", "step": "7", "role": "primary_head",
     "title": "Primary Team Head approval",
     "desc": "First approval on the consolidated Excel. Flag errors directly in the sheet; a note is optional."},
    {"id": "wetlab_qc_review", "step": "7", "role": "wetlab",
     "title": "Wet Lab QC approval",
     "desc": "Second of the two-step approval — Wet Lab checks QC and approves the consolidated Excel."},
    {"id": "bioinfo_review", "step": "8", "role": "bioinfo_head",
     "title": "Bioinfo Team Head approval",
     "desc": "Final sign-off on data quality for the consolidated Excel."},
    {"id": "pdf_uploaded", "step": "9-10", "role": "primary_team",
     "title": "Consolidated PDF upload",
     "desc": "Consolidated PDF (all details from the Excel in report format) uploaded for final review."},
    {"id": "wetlab_final_review", "step": "11", "role": "wetlab",
     "title": "Wet Lab PDF approval",
     "desc": "Wet Lab views the consolidated PDF and approves, with optional notes or corrections."},
    {"id": "completed", "step": "12", "role": None,
     "title": "Samples approved, moved to Tertiary team for analysis",
     "desc": "Every approval is in; the samples are handed off to the Tertiary team for analysis. "
             "All approvals, timestamps and Wet Lab notes remain available to the Primary Team."},
]

STAGE_BY_ID = {s["id"]: s for s in STAGES}
STAGE_INDEX = {s["id"]: i for i, s in enumerate(STAGES)}
FIRST_STAGE_ID = STAGES[0]["id"]

REVIEW_STAGE_IDS = {"primary_head_review", "wetlab_qc_review", "bioinfo_review", "wetlab_final_review"}

# A reviewer requesting changes sends the run back to the upload it was reviewing.
REJECT_TARGET = {
    "primary_head_review": "excel_uploaded",
    "wetlab_qc_review": "excel_uploaded",
    "bioinfo_review": "excel_uploaded",
    "wetlab_final_review": "pdf_uploaded",
}

FILE_REQUIRED_STAGES = {"drive_checked", "excel_uploaded", "pdf_uploaded"}

# The Wet Lab login covers both the initial transfer (logged as the generic "Wet Lab
# Team") and these two approval steps, which are actually done by a named reviewer —
# so the history for these specific stages is attributed to them by name instead of
# the account's display name.
ACTOR_NAME_OVERRIDE = {
    "wetlab_qc_review": "Dr. Sivasankar",
    "wetlab_final_review": "Dr. Sivasankar",
}


def actor_name_for(stage_id: str, account_full_name: str) -> str:
    return ACTOR_NAME_OVERRIDE.get(stage_id, account_full_name)


# Steps that are another team's internal mechanics, hidden from roles with no part in
# them — the raw CSV/Excel backup and the automatic "Primary Team notified" checkpoint
# are Primary Team's own business, so Wet Lab and both team heads should never see
# that step, its files, or its history, in the API response itself (not just the UI).
HIDDEN_STAGES_FOR_ROLE = {
    "wetlab": {"notified", "drive_checked"},
    "primary_head": {"notified", "drive_checked"},
    "bioinfo_head": {"notified", "drive_checked"},
    "primary_team": set(),
}


def can_see_stage(stage_id: str, role: str) -> bool:
    return stage_id not in HIDDEN_STAGES_FOR_ROLE.get(role, set())


def visible_history(history, role):
    return [h for h in history if can_see_stage(h.stage_id, role)]


def stage_role(stage_id: str):
    return STAGE_BY_ID[stage_id]["role"]


def next_stage_after(stage_id: str, action: str) -> str:
    """The stage a run moves to, given where it is and the action just taken."""
    if stage_id in REVIEW_STAGE_IDS and action == "rejected":
        return REJECT_TARGET[stage_id]
    return STAGES[STAGE_INDEX[stage_id] + 1]["id"]
