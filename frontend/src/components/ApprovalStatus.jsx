import { useEffect, useState } from "react";
import { api } from "../api";
import { ROLES, STAGE_BY_ID } from "../workflow";
import { Alert, Icon, Spinner, formatDateTime } from "./ui";

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

      <div className="divide-y divide-slate-200 px-5 pb-5 max-h-[32rem] overflow-y-auto lg:max-h-none lg:flex-1 lg:min-h-0">
        {relevant.map((run) => (
          <StatusRow key={run.id} run={run} onViewRun={onViewRun} />
        ))}
      </div>
    </section>
  );
}

function StatusRow({ run, onViewRun }) {
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
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => onViewRun(run.run_number)}
          className="font-mono font-bold text-sm hover:text-brand-800 hover:underline"
        >
          {run.run_number}
        </button>
        {run.status === "completed" ? (
          <span className="chip bg-emerald-100 text-emerald-800">Samples Approved - move to tertiary team</span>
        ) : (
          <span className="chip bg-amber-100 text-amber-800">{stage.title}</span>
        )}
      </div>

      {qcSummary && (qcSummary.failed > 0 || qcSummary.resequencing > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {qcSummary.failed > 0 && (
            <span className="chip bg-red-100 text-red-800">⚑ {qcSummary.failed} QC fail{qcSummary.failed > 1 ? "s" : ""}</span>
          )}
          {qcSummary.resequencing > 0 && (
            <span className="chip bg-amber-100 text-amber-800">⚑ {qcSummary.resequencing} re-sequencing request{qcSummary.resequencing > 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-700 mt-1.5">{error}</p>}
      {!detail && !error && (
        <div className="mt-2 text-brand-700">
          <Spinner />
        </div>
      )}

      {detail && (
        <div className="mt-2 pl-0.5 space-y-1.5">
          {(() => {
            // Removing the consolidated Excel/PDF resets the run and logs a "reset"
            // entry — any approval from before that point no longer holds, since it
            // was approving a file that's since been replaced.
            const lastReset = (detail.history || [])
              .filter((h) => h.action === "reset")
              .reduce((latest, h) => (!latest || h.created_at > latest ? h.created_at : latest), null);
            return APPROVAL_STAGES.map((stageId) => {
            const entry = [...(detail.history || [])]
              .reverse()
              .find((h) => h.stage_id === stageId && h.action !== "completed" && (!lastReset || h.created_at > lastReset));
            const meta = STAGE_BY_ID[stageId];
            const pending = !entry;
            return (
              <div key={stageId} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="shrink-0">
                  {pending ? (
                    <Icon name="clock" size={14} className="text-slate-300" />
                  ) : entry.action === "approved" ? (
                    <Icon name="check" size={14} className="text-emerald-600" strokeWidth={2.4} />
                  ) : (
                    <Icon name="x" size={14} className="text-red-600" strokeWidth={2.4} />
                  )}
                </span>
                <span className={pending ? "text-slate-400" : "font-semibold"}>
                  {ROLES[meta.role]?.label}
                </span>
                {pending ? (
                  <span className="text-xs text-slate-400">pending</span>
                ) : (
                  <>
                    <span className="text-xs text-slate-500">
                      {entry.action === "approved" ? "approved" : "requested changes"} ·{" "}
                      {entry.actor_name} · {formatDateTime(entry.created_at)}
                    </span>
                    {entry.note && (
                      <span className="w-full pl-6 text-xs text-slate-600">“{entry.note}”</span>
                    )}
                  </>
                )}
              </div>
            );
            });
          })()}
        </div>
      )}
    </div>
  );
}
