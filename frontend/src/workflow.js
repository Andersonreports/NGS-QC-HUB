// Mirrors backend/app/workflow.py — keep the two in sync.
//
// Wording rule: nothing here mentions step numbers. `title` reads as what the run is
// waiting on ("Consolidated Excel upload"), `heading` is the imperative for whoever
// owns it ("Upload the consolidated Excel"), `action` is the button label, `logVerb`
// is the past-tense phrase used in the Status timeline ("Sethu uploaded the
// consolidated Excel") so a plain completion reads like a sentence, the same way an
// approval reads "Tamilarasu approved".

// All four roles sit in the orange/blue theme: the two teams take the bright tones,
// the two heads the deep tones, which keeps them on-brand and still tells them apart.
// `color`/`soft` are for light surfaces; `onDark` is the variant with enough contrast
// for the dark header bar.
export const ROLES = {
  wetlab: { id: "wetlab", label: "Wet Lab", color: "#c1440e", soft: "#fdeee6", onDark: "#f4a882" },
  primary_team: { id: "primary_team", label: "Primary Team", color: "#1668c1", soft: "#e7f1fd", onDark: "#8dc0f2" },
  primary_head: { id: "primary_head", label: "Primary Team Head", color: "#0b3462", soft: "#e2eaf4", onDark: "#adc8e6" },
  bioinfo_head: { id: "bioinfo_head", label: "Bioinfo Team Head", color: "#8a3a12", soft: "#f7ebe3", onDark: "#dfa77f" },
};

export const STAGES = [
  {
    id: "raw_data_placed",
    role: "wetlab",
    title: "Raw data on common drive",
    logVerb: "placed the raw data on the common drive",
    desc: "FastQ, CSV, Excel and Md5sum files placed on the common drive.",
  },
  {
    id: "dashboard_updated",
    role: "wetlab",
    title: "Marked as transferred",
    logVerb: "marked the run as transferred",
    desc: "Wet Lab confirmed the transfer, which notifies the Primary Team.",
  },
  {
    id: "notified",
    role: "primary_team",
    title: "Primary Team notified",
    desc: "Alert raised that new run data is ready on the common drive.",
  },
  {
    id: "drive_checked",
    role: "primary_team",
    title: "Raw CSV & Excel upload",
    logVerb: "uploaded the raw CSV & Excel",
    heading: "Upload raw CSV & Excel",
    desc: "Check the raw data on the common drive, then upload whichever of the CSV and Excel you have here as backup. One of them is enough, both is fine too.",
    action: "Upload raw backup",
    needsFiles: true,
  },
  {
    id: "excel_uploaded",
    role: "primary_team",
    title: "Consolidated Excel upload",
    logVerb: "uploaded the consolidated Excel",
    heading: "Upload consolidated Excel",
    desc: "Upload the consolidated Excel (raw data plus the essential details and analysis) to send it for approval.",
    action: "Upload & send for approval",
    needsFiles: true,
  },
  {
    id: "excel_head_review",
    roles: ["primary_head", "bioinfo_head"],
    title: "Consolidated Excel approval",
    heading: "Approve the consolidated Excel",
    desc: "Either team head approves the consolidated Excel — one approval is enough. Approve it, or flag errors in the sheet and send it back. Wet Lab may also review it, but the run doesn't wait for them.",
    review: true,
  },
  {
    id: "pdf_uploaded",
    role: "primary_team",
    title: "Consolidated PDF upload",
    logVerb: "uploaded the consolidated PDF",
    heading: "Upload consolidated PDF",
    desc: "Upload the consolidated PDF (all the details from the Excel in report format) for final review.",
    action: "Upload PDF",
    needsFiles: true,
  },
  {
    id: "pdf_head_review",
    roles: ["primary_head", "bioinfo_head"],
    title: "Consolidated PDF approval",
    heading: "Approve the consolidated PDF",
    desc: "Either team head approves the consolidated PDF — one approval is enough. Approve it, or send it back with a note. Wet Lab may also review it, but the run doesn't wait for them.",
    review: true,
  },
  {
    id: "completed",
    role: null,
    title: "Samples approved, moved to Tertiary team for analysis",
    desc: "Every approval is in; the samples are handed off to the Tertiary team for analysis. All timestamps and notes are recorded against the run.",
  },
];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));
export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));

/** Old stage ids from the previous four-approval model, mapped onto the current
 * stages, so in-flight runs and historical entries still resolve. Kept in sync with
 * backend/app/workflow.py's LEGACY_STAGE_ALIAS. */
export const LEGACY_STAGE_ALIAS = {
  primary_head_review: "excel_head_review",
  wetlab_qc_review: "excel_head_review",
  bioinfo_review: "excel_head_review",
  wetlab_final_review: "pdf_head_review",
};

// Let every STAGE_BY_ID / STAGE_INDEX lookup resolve a retired stage id too. A run can
// still carry one until the backend has restarted and migrated it, and the screens read
// `STAGE_BY_ID[run.current_stage].role` directly, which would otherwise crash the page.
for (const [retired, current] of Object.entries(LEGACY_STAGE_ALIAS)) {
  STAGE_BY_ID[retired] = STAGE_BY_ID[current];
  STAGE_INDEX[retired] = STAGE_INDEX[current];
}

export function canonicalStage(stageId) {
  return LEGACY_STAGE_ALIAS[stageId] || stageId;
}

/** The roles allowed to act on a stage — one for most, both heads for a head review. */
export function stageRoles(stageId) {
  const stage = STAGE_BY_ID[stageId];
  if (!stage) return [];
  return stage.roles || (stage.role ? [stage.role] : []);
}

/** The head-review stages where Wet Lab's optional, non-blocking review is available. */
export const WETLAB_REVIEW_STAGES = new Set(["excel_head_review", "pdf_head_review"]);

/** True when Wet Lab may record a (non-blocking) review of the live document. This is
 * deliberately NOT the same as isAwaiting — the run never waits on Wet Lab. */
export function wetlabCanReview(run) {
  return run.status === "in_progress" && WETLAB_REVIEW_STAGES.has(run.current_stage);
}

/** File inputs each upload step asks for. */
export const UPLOAD_SLOTS = {
  drive_checked: [
    { key: "csv", label: "Raw CSV file", accept: ".csv,text/csv" },
    { key: "excel", label: "Raw Excel file", accept: ".xlsx,.xls" },
  ],
  excel_uploaded: [{ key: "excel", label: "Consolidated Excel", accept: ".xlsx,.xls" }],
  pdf_uploaded: [{ key: "pdf", label: "Consolidated PDF", accept: ".pdf" }],
};

/** Steps whose slots aren't all mandatory — just at least one of them. The raw
 * backup is sometimes only a CSV, sometimes only an Excel, sometimes both. */
export const UPLOAD_ANY_OF = new Set(["drive_checked"]);

/** The upload steps the Primary Team owns, in the order they have to happen. */
export const PRIMARY_TEAM_UPLOADS = ["drive_checked", "excel_uploaded", "pdf_uploaded"];

/**
 * Steps that are another team's internal mechanics, hidden from roles with no part
 * in them — the raw CSV/Excel backup and the Primary Team's own alert are Primary
 * Team business, so Wet Lab and the heads never see those steps or their files.
 */
const HIDDEN_STAGES = {
  wetlab: ["notified", "drive_checked"],
  primary_head: ["notified", "drive_checked"],
  bioinfo_head: ["notified", "drive_checked"],
  primary_team: [],
};

export function canSeeStage(stageId, role) {
  return !(HIDDEN_STAGES[role] || []).includes(stageId);
}

export function visibleStages(role) {
  return STAGES.filter((s) => canSeeStage(s.id, role));
}

/**
 * Every role can see the current workflow position, even where files and detailed
 * history for another team's internal step remain restricted.
 */
export function stageLabelFor(run, role) {
  const stage = STAGE_BY_ID[run.current_stage];
  if (!stage) return "";
  return stage.title;
}

export function stageOf(run) {
  return STAGE_BY_ID[run.current_stage];
}

export function isAwaiting(run, role) {
  const stage = STAGE_BY_ID[run.current_stage];
  return run.status === "in_progress" && !!stage && stageRoles(run.current_stage).includes(role);
}

export function wasSentBack(run) {
  const last = run.history?.[run.history.length - 1];
  return last?.action === "rejected" || last?.action === "reset";
}

/**
 * One label for where a run stands, including whether a send-back has been
 * re-uploaded yet. Fields come from the runs endpoints. Blue reads as "moving
 * normally" (whether that's still in progress or already done), and only the one
 * state that actually needs a person to act — a send-back awaiting re-upload —
 * gets orange, so that color keeps its meaning instead of covering every row.
 */
export function runState(run) {
  if (run.status === "completed") {
    return { key: "completed", label: "Completed", chip: "bg-brand-100 text-brand-800" };
  }
  if (run.awaiting_reupload) {
    return {
      key: "needs_reupload",
      label: "Needs re-upload",
      chip: "bg-accent-100 text-accent-800",
      urgent: true,
    };
  }
  if (run.rejection_count > 0) {
    return { key: "reuploaded", label: "Back in review", chip: "bg-brand-50 text-brand-700" };
  }
  return { key: "in_progress", label: "In progress", chip: "bg-brand-50 text-brand-700" };
}
