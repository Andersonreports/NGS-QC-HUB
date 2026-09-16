import { useEffect, useState } from "react";
import { api } from "../api";
import { STAGE_BY_ID, isAwaiting, wasSentBack } from "../workflow";
import RunActionForm from "./RunActionForm";
import { Alert, Icon, Spinner, StatusChip, daysSince, formatDateTime, timeAgo } from "./ui";

const REMINDER_AFTER_DAYS = 5;

/** A run's current stage is the very first thing Primary Team does with a fresh
 * transfer — the one moment a brand-new run most needs to stand out. */
function isFreshIntake(run) {
  return run.current_stage === "drive_checked";
}

/** Past the 5-day mark with the consolidated Excel still not uploaded. */
function needsConsolidatedReminder(run) {
  return run.current_stage === "excel_uploaded" && daysSince(run.created_at) >= REMINDER_AFTER_DAYS;
}

/**
 * Runs sitting on the signed-in user's team, each expanding into its own action.
 * Renders nothing at all when there's nothing pending — no "no work" message.
 * New intakes and overdue consolidated-Excel uploads are called out and sorted first,
 * since those are the two things Primary Team most needs to notice immediately.
 */
export default function PendingRuns({ runs, user, onChanged, onViewRun, title }) {
  const mine = [...runs.filter((r) => isAwaiting(r, user.role))].sort((a, b) => {
    const score = (r) => (r.awaiting_reupload ? 3 : needsConsolidatedReminder(r) ? 2 : isFreshIntake(r) ? 1 : 0);
    return score(b) - score(a) || new Date(b.updated_at) - new Date(a.updated_at);
  });
  const [openRun, setOpenRun] = useState(null);

  if (mine.length === 0) return null;

  return (
    <section className="card border border-slate-200 border-l-4 border-l-brand-600 overflow-hidden flex flex-col lg:h-full">
      <header className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-200 shrink-0">
        <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
          <Icon name="info" size={16} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-900 truncate">{title}</h2>
          <p className="text-xs text-slate-500 truncate">Runs at your team's current step in the workflow</p>
        </div>
        <span className="chip border border-brand-300 text-brand-800 bg-white ml-auto font-semibold shrink-0 whitespace-nowrap">
          {mine.length} {mine.length === 1 ? "item" : "items"}
        </span>
      </header>

      <ul className="divide-y divide-slate-200 px-5 max-h-[32rem] overflow-y-auto lg:max-h-none lg:flex-1 lg:min-h-0">
        {mine.map((run) => {
          const stage = STAGE_BY_ID[run.current_stage];
          const isOpen = openRun === run.run_number;
          const fresh = isFreshIntake(run);
          const overdue = needsConsolidatedReminder(run);
          const rejected = run.awaiting_reupload;
          const age = daysSince(run.created_at);

          return (
            <li
              key={run.id}
              className={`py-3.5 first:pt-4 last:pb-4 ${
                rejected ? "-mx-2 px-2 rounded-lg bg-red-50/70 border border-red-200 my-2" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => onViewRun(run.run_number)}
                  className="font-mono font-bold text-sm hover:text-brand-800 hover:underline"
                >
                  {run.run_number}
                </button>
                {fresh && <span className="chip bg-red-100 text-red-800">New transfer</span>}
                {overdue && (
                  <span className="chip bg-red-600 text-white">
                    <Icon name="clock" size={11} strokeWidth={2.4} />
                    {age}d since transfer
                  </span>
                )}
                {rejected && <span className="chip bg-red-600 text-white">Changes requested</span>}
                {wasSentBack(run) && <StatusChip run={run} />}
                <span className="text-sm font-semibold text-slate-700 flex-1 min-w-[11rem]">
                  {stage.title}
                </span>
                <span className="text-xs text-slate-400">{timeAgo(run.updated_at)}</span>
                <button
                  className={
                    isOpen
                      ? "btn-ghost py-1.5 px-3 text-xs"
                      : overdue
                      ? "btn-danger py-1.5 px-3 text-xs"
                      : "btn-primary py-1.5 px-3 text-xs"
                  }
                  onClick={() => setOpenRun(isOpen ? null : run.run_number)}
                >
                  {isOpen ? "Close" : stage.review ? "Review" : "Take action"}
                </button>
              </div>

              {fresh && !isOpen && (
                <p className="text-xs text-brand-700 font-medium mt-1.5 flex items-center gap-1.5">
                  <Icon name="upload" size={12} />
                  Raw data was transferred — upload the raw CSV &amp; Excel to get started.
                </p>
              )}
              {overdue && !isOpen && (
                <p className="text-xs text-red-700 font-medium mt-1.5 flex items-center gap-1.5">
                  <Icon name="clock" size={12} />
                  {age} days have passed since the raw data was transferred — the consolidated Excel is still outstanding.
                </p>
              )}
              {rejected && (
                <ReviewerFeedback run={run} />
              )}

              {isOpen && (
                <div className="mt-3 fade-up">
                  <InlineAction
                    runNumber={run.run_number}
                    user={user}
                    onDone={() => {
                      setOpenRun(null);
                      onChanged?.();
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Show the reviewer feedback beside the re-upload action, so Primary Team does
 * not need to open the spreadsheet before understanding what must be corrected. */
function ReviewerFeedback({ run }) {
  const [annotations, setAnnotations] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .getSheet(run.run_number)
      .then((sheet) => {
        if (!alive) return;
        setAnnotations(sheet.annotations.filter((item) => item.author_role === "primary_head"));
      })
      .catch(() => alive && setAnnotations([]));
    return () => {
      alive = false;
    };
  }, [run.run_number, run.updated_at]);

  return (
    <div className="mt-3 rounded-lg border border-red-200 bg-white/80 px-3 py-2.5 text-xs">
      <div className="font-bold text-red-800 flex items-center gap-1.5">
        <Icon name="x" size={13} strokeWidth={2.5} /> Reviewer feedback — correct before re-uploading
      </div>
      {run.last_rejection_note && (
        <p className="mt-1.5 text-red-900">
          <span className="font-semibold">{run.last_rejection_by || "Reviewer"}:</span> “{run.last_rejection_note}”
        </p>
      )}
      {annotations === null ? (
        <div className="mt-2 text-slate-400 flex items-center gap-1"><Spinner /> Loading sheet flags…</div>
      ) : annotations.length > 0 ? (
        <ul className="mt-2 space-y-1.5 border-t border-red-100 pt-2">
          {annotations.map((annotation) => (
            <li key={annotation.id} className="flex items-start gap-1.5 text-red-900">
              <span className="font-bold text-red-700 leading-4">⚑</span>
              <span>
                <span className="font-semibold">{annotationLocation(annotation)}:</span> {annotation.text}
                <span className="text-red-700/70"> · {annotation.author_name} · <span className="font-bold text-black">{formatDateTime(annotation.created_at)}</span></span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function annotationLocation(annotation) {
  if (annotation.scope === "column") return `Column ${annotation.column}`;
  if (annotation.scope === "row") return `Row ${(annotation.row_index ?? 0) + 1}`;
  return `Row ${(annotation.row_index ?? 0) + 1} · ${annotation.column}`;
}

/** Fetches the run's full detail (history + attachments) so the action form has what it needs. */
function InlineAction({ runNumber, user, onDone }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .getRun(runNumber)
      .then((data) => alive && setRun(data))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [runNumber]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!run)
    return (
      <div className="flex justify-center py-6 text-brand-700">
        <Spinner />
      </div>
    );

  const sentBackNote = wasSentBack(run) ? run.history[run.history.length - 1] : null;

  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/60 space-y-3">
      {sentBackNote?.note && (
        <Alert kind="warn">
          <span className="font-semibold">Sent back by {sentBackNote.actor_name}:</span> “{sentBackNote.note}”
        </Alert>
      )}
      <RunActionForm run={run} user={user} onDone={onDone} />
    </div>
  );
}
