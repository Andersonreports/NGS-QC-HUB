"""Single source of truth for the Wet Lab -> Bioinfo data approval pipeline.

Approval model: the consolidated Excel and the consolidated PDF are each gated by a
single head-review step whose owner is *either* the Primary Team Head *or* the Bioinfo
Team Head — whichever acts first decides (approve -> proceed, request changes -> send
the document back for re-upload). The other head's approval is not required.

Wet Lab no longer gates either document. While a document sits at its head-review step,
Wet Lab may record a non-blocking "Reviewed" entry (with an optional note); it never
holds up or blocks the run.

  diagram step        stage id               who
  1  raw data -> drive    raw_data_placed        Wet Lab
  2  dashboard updated    dashboard_updated      Wet Lab
  3  notification         notified               Primary Team (automatic)
  4  raw CSV + Excel      drive_checked          Primary Team
  5-6 consolidated Excel  excel_uploaded         Primary Team
  7  Excel approval       excel_head_review      Primary Head OR Bioinfo Head (either)
                          (Wet Lab reviews here, non-blocking)
  8-9 consolidated PDF    pdf_uploaded           Primary Team
  10 PDF approval         pdf_head_review        Primary Head OR Bioinfo Head (either)
                          (Wet Lab reviews here, non-blocking)
  11 status + notes       completed              —
"""

ROLES = ["wetlab", "primary_team", "primary_head", "bioinfo_head"]

# The two roles that can resolve a head-review step — either one is enough.
HEAD_ROLES = ["primary_head", "bioinfo_head"]

# A built-in super-role, purely for testing/administration: an "admin" account can
# act as any of the four pipeline roles, chosen per-request via the X-Act-As-Role
# header (see deps.get_current_user), so one login can exercise every role's screens
# and actions without logging out and back in. "admin" is deliberately NOT a member
# of ROLES — ROLES drives per-role iteration (notification fan-out, per-role counts)
# that an admin has no part in; it only ever stands in for one of these roles.
ADMIN_ROLE = "admin"
IMPERSONATABLE_ROLES = ROLES  # the roles an admin may act as

# Which roles each account may switch between (admin and Bioinfo Head: all of them).
# The Primary Team Head may only move between the three primary-side roles.
SWITCHABLE_ROLES = {
    ADMIN_ROLE: list(ROLES),
    "bioinfo_head": list(ROLES),
    "primary_head": ["wetlab", "primary_team", "primary_head"],
}

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
     "desc": "Consolidated Excel (raw data plus essential details and analysis) uploaded for review and approval."},
    {"id": "excel_head_review", "step": "7", "roles": HEAD_ROLES,
     "title": "Consolidated Excel approval",
     "desc": "Either the Primary Team Head or the Bioinfo Team Head approves the consolidated Excel. "
             "Wet Lab may review it too, but the run does not wait for them."},
    {"id": "pdf_uploaded", "step": "8-9", "role": "primary_team",
     "title": "Consolidated PDF upload",
     "desc": "Consolidated PDF (all details from the Excel in report format) uploaded for final approval."},
    {"id": "pdf_head_review", "step": "10", "roles": HEAD_ROLES,
     "title": "Consolidated PDF approval",
     "desc": "Either the Primary Team Head or the Bioinfo Team Head approves the consolidated PDF. "
             "Wet Lab may review it too, but the run does not wait for them."},
    {"id": "completed", "step": "11", "role": None,
     "title": "Samples approved, moved to Tertiary team for analysis",
     "desc": "Every approval is in; the samples are handed off to the Tertiary team for analysis. "
             "All approvals, timestamps and Wet Lab notes remain available to the Primary Team."},
]

STAGE_BY_ID = {s["id"]: s for s in STAGES}
STAGE_INDEX = {s["id"]: i for i, s in enumerate(STAGES)}
FIRST_STAGE_ID = STAGES[0]["id"]

REVIEW_STAGE_IDS = {"excel_head_review", "pdf_head_review"}

# A reviewer requesting changes sends the run back to the upload it was reviewing.
REJECT_TARGET = {
    "excel_head_review": "excel_uploaded",
    "pdf_head_review": "pdf_uploaded",
}

FILE_REQUIRED_STAGES = {"drive_checked", "excel_uploaded", "pdf_uploaded"}

# While a document is parked at its head-review step, Wet Lab may log a non-blocking
# review of it. This maps the live head-review step to the upload step that holds the
# document under review — the Wet Lab "reviewed" history entry is recorded against that
# upload stage so it lines up with the document in the approval view.
WETLAB_REVIEW_DOC_STAGE = {
    "excel_head_review": "excel_uploaded",
    "pdf_head_review": "pdf_uploaded",
}

# Legacy stage ids from the previous (four-approval) model, mapped onto the current
# stages. Used to remap any in-flight run's position and to render old history entries.
LEGACY_STAGE_ALIAS = {
    "primary_head_review": "excel_head_review",
    "wetlab_qc_review": "excel_head_review",
    "bioinfo_review": "excel_head_review",
    "wetlab_final_review": "pdf_head_review",
}


def stage_roles(stage_id: str) -> set:
    """The set of roles allowed to act on a stage — one role for most, both heads for
    a head-review stage."""
    stage = STAGE_BY_ID[stage_id]
    if stage.get("roles"):
        return set(stage["roles"])
    role = stage.get("role")
    return {role} if role else set()


def wetlab_can_review(current_stage: str) -> bool:
    """True when a run is parked at a head-review step, so Wet Lab's optional,
    non-blocking review of the live document is available."""
    return current_stage in WETLAB_REVIEW_DOC_STAGE


# The Wet Lab login covers both the initial transfer (logged as the generic "Wet Lab
# Team") and the non-blocking document review, which is actually done by a named
# reviewer — so a "reviewed" action is attributed to them by name instead of the
# account's display name.
WETLAB_REVIEWER_NAME = "Dr. Sivasankar"


def actor_name_for(action: str, role: str, account_full_name: str) -> str:
    if action == "reviewed" and role == "wetlab":
        return WETLAB_REVIEWER_NAME
    return account_full_name


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
    return STAGE_BY_ID[stage_id].get("role")


def next_stage_after(stage_id: str, action: str) -> str:
    """The stage a run moves to, given where it is and the action just taken."""
    if stage_id in REVIEW_STAGE_IDS and action == "rejected":
        return REJECT_TARGET[stage_id]
    return STAGES[STAGE_INDEX[stage_id] + 1]["id"]
