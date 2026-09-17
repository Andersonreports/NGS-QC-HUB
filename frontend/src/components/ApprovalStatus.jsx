import { useEffect, useState } from "react";
import { api } from "../api";
import { ROLES, STAGE_BY_ID } from "../workflow";
import { Icon, Spinner, formatDateTime } from "./ui";

const APPROVAL_STAGES = [
  "primary_head_review",
  "wetlab_qc_review",
  "bioinfo_review",
  "wetlab_final_review",
];

/**
 * A shared view of approval status — who approved what, when, and any notes left,
 * for every run still in progress, whatever stage it's actually at (runs that
 * haven't reached the approval stages yet just show every approval as pending).
 */
export default function ApprovalStatus({ runs, onViewRun }) {
  const relevant = runs
    .filter((r) => r.status === "in_progress")
    // A newly created run naturally appears first; any later approval, rejection,
    // or re-upload refreshes updated_at and moves that run to the top instead.
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  if (relevant.length === 0) return null;

  return (
    <section className="card overflow-hidden flex flex-col lg:h-full">
      <header className="p-5 pb-3 shrink-0">
        <h2 className="text-base font-bold">Approval status &amp; notes</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Track who has approved what, when, and any notes they left.
        </p>
      </header>

      <div className="space-y-3 px-5 pb-5 max-h-[32rem] overflow-y-auto lg:max-h-none lg:flex-1 lg:min-h-0">
        {relevant.map((run) => (
          <StatusCard key={run.id} run={run} onViewRun={onViewRun} />
        ))}
      </div>
    </section>
  );
}

function StatusCard({ run, onViewRun }) {
  const [detail, setDetail] = useState(null);
  const [qcSummary, setQcSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .getRun(run.run_number)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [run.run_number, run.updated_at]);

  useEffect(() => {
    let alive = true;
    api
      .getSheet(run.run_number)
      .then((sheet) => {
        if (!alive) return;
        setQcSummary({
          failed: sheet.rows.filter((row) => row.qc_pass === "Fail").length,
          resequencing: sheet.rows.filter((row) => row.resequencing === "Yes").length,
        });
      })
      .catch(() => alive && setQcSummary(null));
    return () => {
      alive = false;
    };
  }, [run.run_number, run.updated_at]);

  const stage = STAGE_BY_ID[run.current_stage];

  return (
    <div className="border border-slate-200 rounded-lg p-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => onViewRun(run.run_number)}
          className="font-mono font-bold text-sm hover:text-brand-800 hover:underline"
        >
          {run.run_number}
        </button>
        <span className={`chip ${run.status === "completed" ? "bg-brand-100 text-brand-800" : "bg-brand-50 text-brand-700"}`}>
          {run.status === "completed" ? "Approved, moved to Tertiary team" : stage.title}
        </span>
      </div>

      {/* Only while it's the live reason this run is sent back — once Primary Team
          re-uploads and it's re-approved, this stops being current information and
          would just read as a contradiction next to an "approved" line below. The
          flags themselves stay recorded in the run's own Status history. */}
      {run.awaiting_reupload && qcSummary && (qcSummary.failed > 0 || qcSummary.resequencing > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {qcSummary.failed > 0 && (
            <span className="chip bg-accent-300 text-accent-900">⚑ {qcSummary.failed} QC fail{qcSummary.failed > 1 ? "s" : ""}</span>
          )}
          {qcSummary.resequencing > 0 && (
            <span className="chip bg-accent-100 text-accent-800">⚑ {qcSummary.resequencing} re-sequencing request{qcSummary.resequencing > 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {error && <p className="text-xs text-accent-900 mt-2">{error}</p>}
      {!detail && !error && (
        <div className="mt-3 text-brand-700">
          <Spinner />
        </div>
      )}

      {detail && <ApprovalSteps history={detail.history} />}
    </div>
  );
}

/** A small vertical stepper — one node per approval, connected by a line, so the
 * sequence reads at a glance instead of as a flat stack of similar-looking lines. */
function ApprovalSteps({ history }) {
  // Removing the consolidated Excel/PDF resets the run and logs a "reset" entry —
  // any approval from before that point no longer holds, since it was approving a
  // file that's since been replaced.
  const lastReset = (history || [])
    .filter((h) => h.action === "reset")
    .reduce((latest, h) => (!latest || h.created_at > latest ? h.created_at : latest), null);

  return (
    <div className="mt-3">
      {APPROVAL_STAGES.map((stageId, i) => {
        const entry = [...(history || [])]
          .reverse()
          .find((h) => h.stage_id === stageId && h.action !== "completed" && (!lastReset || h.created_at > lastReset));
        const meta = STAGE_BY_ID[stageId];
        const pending = !entry;
        const rejected = entry?.action === "rejected";
        const isLast = i === APPROVAL_STAGES.length - 1;

        return (
          <div key={stageId} className={`relative pl-6 ${isLast ? "" : "pb-3.5"}`}>
            {!isLast && (
              <span
                className={`absolute left-[7px] top-4 bottom-0 w-px ${pending ? "bg-slate-200" : "bg-brand-200"}`}
              />
            )}
            <span
              className={`absolute left-0 top-0 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                pending
                  ? "border-2 border-slate-300 bg-white"
                  : rejected
                  ? "bg-accent-700"
                  : "bg-brand-600"
              }`}
            >
              {!pending && <Icon name={rejected ? "x" : "check"} size={9} className="text-white" strokeWidth={3.2} />}
            </span>

            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`text-sm ${pending ? "text-slate-400" : "font-semibold text-slate-800"}`}>
                {ROLES[meta.role]?.label}
              </span>
              <span className="text-xs text-slate-400">
                {pending
                  ? "pending"
                  : `${rejected ? "requested changes" : "approved"} · ${entry.actor_name} · ${formatDateTime(entry.created_at)}`}
              </span>
            </div>

            {entry?.note && (
              <p className="mt-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
                “{entry.note}”
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
