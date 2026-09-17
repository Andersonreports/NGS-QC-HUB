import { useEffect, useState } from "react";
import { api } from "../api";
import {
  STAGE_BY_ID,
  STAGE_INDEX,
  canSeeStage,
  isAwaiting,
  runState,
  stageLabelFor,
  visibleStages,
} from "../workflow";
import FilePreview from "./FilePreview";
import FileRow from "./FileRow";
import RunActionForm from "./RunActionForm";
import { Alert, Icon, RoleChip, Spinner, formatDateTime } from "./ui";

/**
 * One run in full: its files (click any to preview on the right), whatever action is
 * open to this user, and the step-by-step history of who did what and when.
 */
export default function RunHistory({ runNumber, user, onBack, onChanged, onSilentChange, refreshKey }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sheetStats, setSheetStats] = useState(undefined); // undefined = loading, null = no sheet yet
  // Both side columns start open — closing either one hands its width to the
  // preview in the middle, which matters most for wide consolidated Excels.
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const role = user?.role;

  useEffect(() => {
    let alive = true;
    setSheetStats(undefined);
    api
      .getSheet(runNumber)
      .then((sheet) => {
        if (!alive) return;
        setSheetStats({
          total: sheet.rows.length,
          qcFailed: sheet.rows.filter((r) => r.qc_pass === "Fail").length,
          resequenced: sheet.rows.filter((r) => r.resequencing === "Yes").length,
        });
      })
      .catch(() => alive && setSheetStats(null));
    return () => {
      alive = false;
    };
  }, [runNumber, refreshKey]);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .getRun(runNumber)
      .then((data) => {
        if (!alive) return;
        setRun(data);
        // Show the most recent file this viewer is allowed to see, rather than an
        // empty pane — but never a step that isn't theirs (e.g. Wet Lab shouldn't
        // land on the raw CSV/Excel the Primary Team keeps internally).
        setPreview((current) => {
          if (current) return current;
          const files = (data.history || [])
            .filter((e) => canSeeStage(e.stage_id, role))
            .flatMap((e) => (e.attachments || []).map((a) => ({ e, a })));
          const last = files[files.length - 1];
          return last
            ? {
                kind: "remote",
                runNumber: data.run_number,
                attachmentId: last.a.id,
                filename: last.a.filename,
                sizeBytes: last.a.size_bytes,
                stageId: last.e.stage_id,
              }
            : null;
        });
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [runNumber, refreshKey, role]);

  async function handleFileDeleted() {
    setPreview(null);
    try {
      setRun(await api.getRun(runNumber));
    } catch (err) {
      setError(err.message);
    }
    onSilentChange?.();
  }

  const [deletingRun, setDeletingRun] = useState(false);
  async function handleDeleteRun() {
    if (
      !window.confirm(
        `Permanently remove run ${runNumber}? Its files and history will be deleted for good. This can't be undone.`
      )
    )
      return;
    setDeletingRun(true);
    try {
      await api.deleteRun(runNumber);
      onSilentChange?.();
      onBack();
    } catch (err) {
      setError(err.message);
      setDeletingRun(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <Alert kind="error">{error}</Alert>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <div className="card p-8 flex justify-center text-brand-700">
          <Spinner />
        </div>
      </div>
    );
  }

  const currentIdx = STAGE_INDEX[run.current_stage];
  const currentVisible = canSeeStage(run.current_stage, role);
  const state = runState(run);
  const actionable = user && isAwaiting(run, user.role);
  const stages = visibleStages(role);
  const entriesByStage = {};
  (run.history || []).forEach((h) => {
    (entriesByStage[h.stage_id] ||= []).push(h);
  });
  const allFiles = (run.history || [])
    .filter((entry) => canSeeStage(entry.stage_id, role))
    .flatMap((entry) => (entry.attachments || []).map((attachment) => ({ entry, attachment })));

  // The grid's column template shifts as each side column is closed, so the
  // preview in the middle always gets whatever width is freed up.
  const gridCols = leftOpen && rightOpen
    ? "lg:grid-cols-[minmax(17rem,1fr)_minmax(0,2.2fr)_minmax(17rem,1fr)]"
    : leftOpen && !rightOpen
    ? "lg:grid-cols-[minmax(17rem,1fr)_minmax(0,1fr)]"
    : !leftOpen && rightOpen
    ? "lg:grid-cols-[minmax(0,1fr)_minmax(17rem,1fr)]"
    : "lg:grid-cols-1";

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-var(--header-h,7.5rem)-3rem)] lg:overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <BackButton onBack={onBack} />
        <span className="font-mono text-lg font-extrabold">{run.run_number}</span>
        <span className={`chip ${state.chip}`}>{state.label}</span>
        <span className="text-sm text-slate-500">{stageLabelFor(run, role)}</span>
        {currentVisible && STAGE_BY_ID[run.current_stage].role && (
          <RoleChip role={STAGE_BY_ID[run.current_stage].role} />
        )}
        {role === "bioinfo_head" && (
          <button
            onClick={handleDeleteRun}
            disabled={deletingRun}
            className="ml-auto text-xs font-bold text-accent-800 hover:text-accent-900 flex items-center gap-1.5"
            title="Permanently remove this run"
          >
            {deletingRun ? <Spinner /> : <Icon name="x" size={13} strokeWidth={2.4} />}
            Remove run
          </button>
        )}
      </div>

      {/* The action itself — Approve/Reject or Upload — sits at the very top,
          full width, above the three columns below. It's the one thing that
          matters most on this page when it's your turn, so it shouldn't be
          something you have to scroll a narrow column to find. */}
      {actionable && (
        <section className="card p-3.5 border-l-4 border-l-accent-600 shrink-0">
          {!STAGE_BY_ID[run.current_stage].review && (
            <header className="mb-3">
              <h2 className="text-base font-bold">
                {STAGE_BY_ID[run.current_stage].heading || STAGE_BY_ID[run.current_stage].title}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">This run is waiting on you.</p>
            </header>
          )}
          <RunActionForm
            run={run}
            user={user}
            compact
            onDone={(updated) => {
              setRun(updated);
              onChanged?.();
            }}
          />
        </section>
      )}

      {/* Left: every uploaded file. Middle: the sample counts, then the preview.
          Right: the full step-by-step status history. Each column scrolls on its
          own, within a fixed-height row, instead of growing the whole page. */}
      <div className={`grid grid-cols-1 gap-4 items-stretch ${gridCols} lg:grid-rows-[minmax(0,1fr)] lg:flex-1 lg:min-h-0 lg:overflow-hidden`}>
        {leftOpen && (
        <div className="min-w-0 space-y-4 lg:h-full lg:overflow-y-auto">
          <section className="card p-5">
            <header className="mb-3 flex items-start gap-3">
              <div className="flex-1">
                <h2 className="text-base font-bold">Files for this run</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {allFiles.length === 0
                    ? "Nothing uploaded yet."
                    : `${allFiles.length} file${allFiles.length > 1 ? "s" : ""}. Click one to preview it.`}
                </p>
              </div>
              <button
                onClick={() => setLeftOpen(false)}
                className="btn-ghost py-1.5 px-2.5 text-xs shrink-0"
                title="Hide this panel to give the preview more room"
              >
                <Icon name="chevronLeft" size={14} />
              </button>
            </header>
            {allFiles.length > 0 && (
              <div className="space-y-2">
                {allFiles.map(({ entry, attachment }) => (
                  <div key={attachment.id}>
                    <FileRow
                      file={attachment}
                      runNumber={run.run_number}
                      stageId={entry.stage_id}
                      uploadedBy={`${STAGE_BY_ID[entry.stage_id]?.title ?? ""} · ${entry.actor_name}`}
                      uploadedAt={entry.created_at}
                      onPreview={setPreview}
                      active={preview?.attachmentId === attachment.id}
                      canDelete={role === "primary_team"}
                      onDeleted={handleFileDeleted}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        )}

        <div className="min-w-0 flex flex-col gap-4 lg:h-full lg:overflow-hidden">
          {/* One slim row: the show-files/show-status toggles (only when their
              column is collapsed) share it with the sample counts, instead of
              each taking a whole row of their own above the actual data. */}
          <div className="shrink-0 flex items-center gap-3">
            {!leftOpen && (
              <button
                onClick={() => setLeftOpen(true)}
                className="hidden lg:flex btn-ghost py-1 px-2.5 text-xs shrink-0"
                title="Show files & action"
              >
                <Icon name="chevronRight" size={13} />
                Files
              </button>
            )}
            <RunStatCards stats={sheetStats} />
            {!rightOpen && (
              <button
                onClick={() => setRightOpen(true)}
                className="hidden lg:flex btn-ghost py-1 px-2.5 text-xs shrink-0 ml-auto"
                title="Show status history"
              >
                Status
                <Icon name="chevronLeft" size={13} />
              </button>
            )}
          </div>
          <div className="min-h-[24rem] lg:flex-1 lg:min-h-0">
            <FilePreview source={preview} role={user.role} onClear={() => setPreview(null)} />
          </div>
        </div>

        {rightOpen && (
        <div className="min-w-0 lg:h-full lg:overflow-y-auto">
          <section className="card p-5">
            <header className="mb-4 flex items-start gap-3">
              <h2 className="text-base font-bold flex-1">Status</h2>
              <button
                onClick={() => setRightOpen(false)}
                className="btn-ghost py-1.5 px-2.5 text-xs shrink-0"
                title="Hide this panel to give the preview more room"
              >
                <Icon name="chevronRight" size={14} />
              </button>
            </header>
            <ol>
              {stages.map((stage, i) => {
                const globalIdx = STAGE_INDEX[stage.id];
                const done = globalIdx < currentIdx || (globalIdx === currentIdx && run.status === "completed");
                const current = globalIdx === currentIdx && run.status !== "completed";
                const entries = entriesByStage[stage.id] || [];
                return (
                  <li key={stage.id} className="relative pl-11 pb-6 last:pb-0">
                    {i !== stages.length - 1 && (
                      <span
                        className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${
                          done ? "bg-brand-500" : "bg-slate-200"
                        }`}
                      />
                    )}
                    <span
                      className={`absolute left-0 top-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                        ${
                          done
                            ? "bg-brand-100 text-brand-700"
                            : current
                            ? "bg-brand-100 text-brand-800 ring-2 ring-brand-600"
                            : "bg-slate-100 text-slate-400"
                        }`}
                    >
                      {done ? (
                        <Icon name="check" size={15} strokeWidth={2.6} />
                      ) : (
                        <span className={`w-2 h-2 rounded-full ${current ? "bg-brand-700" : "bg-slate-300"}`} />
                      )}
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-bold ${done || current ? "text-slate-900" : "text-slate-400"}`}
                      >
                        {stage.title}
                      </span>
                      {current && <span className="chip bg-accent-100 text-accent-800">Current</span>}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{stage.desc}</p>

                    {entries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`mt-2.5 rounded-lg border px-3.5 py-3 ${
                          entry.action === "rejected" || entry.action === "reset"
                            ? "bg-accent-200 border-accent-400"
                            : "bg-slate-50 border-slate-200"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-slate-800">{entry.actor_name}</span>
                          <span
                            className={`font-bold ${
                              entry.action === "rejected" || entry.action === "reset"
                                ? "text-accent-900"
                                : entry.action === "approved"
                                ? "text-brand-700"
                                : "text-slate-500"
                            }`}
                          >
                            {entry.action === "approved"
                              ? "approved"
                              : entry.action === "rejected"
                              ? "requested changes"
                              : entry.action === "reset"
                              ? "removed the file, reset for re-upload"
                              : entry.note?.includes("has been reuploaded after requested changes")
                              ? "reuploaded"
                              : stage.logVerb || "completed"}
                          </span>
                          <span className="text-slate-400 ml-auto">{formatDateTime(entry.created_at)}</span>
                        </div>
                        {entry.note && entry.action !== "reset" && (
                          <p className="text-sm text-slate-700 mt-1.5">“{entry.note}”</p>
                        )}
                        {entry.attachments?.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {entry.attachments.map((a) => (
                              <FileRow
                                key={a.id}
                                file={a}
                                runNumber={run.run_number}
                                stageId={entry.stage_id}
                                onPreview={setPreview}
                                active={preview?.attachmentId === a.id}
                                canDelete={role === "primary_team"}
                                onDeleted={handleFileDeleted}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
        )}
      </div>
    </div>
  );
}

/** Total samples / QC failed / re-sequenced, straight off the consolidated Excel's
 * live rows — undefined while loading, null once confirmed no sheet exists yet. */
function RunStatCards({ stats }) {
  const tiles = [
    {
      id: "total",
      label: "Total samples",
      value: stats === undefined ? "…" : stats === null ? "—" : stats.total,
      tone: "text-slate-900",
      icon: "flask",
    },
    {
      id: "qc_failed",
      label: "QC failed",
      value: stats === undefined ? "…" : stats === null ? "—" : stats.qcFailed,
      tone: stats?.qcFailed > 0 ? "text-accent-900" : "text-slate-400",
      icon: "x",
    },
    {
      id: "resequenced",
      label: "Re-sequenced",
      value: stats === undefined ? "…" : stats === null ? "—" : stats.resequenced,
      tone: stats?.resequenced > 0 ? "text-accent-700" : "text-slate-400",
      icon: "refresh",
    },
  ];

  return (
    <div className="flex-1 min-w-0 flex items-center gap-4 flex-wrap">
      {tiles.map((t) => (
        <span key={t.id} className="flex items-center gap-1.5 whitespace-nowrap">
          <Icon name={t.icon} size={14} className="text-slate-300 shrink-0" />
          <span className={`text-xl font-extrabold ${t.tone}`}>{t.value}</span>
          <span className="text-xs font-semibold text-slate-500">{t.label}</span>
        </span>
      ))}
    </div>
  );
}

function BackButton({ onBack }) {
  return (
    <button onClick={onBack} className="btn-ghost">
      <Icon name="arrowLeft" size={15} />
      Back
    </button>
  );
}
