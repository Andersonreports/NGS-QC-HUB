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
  wetlabCanReview,
} from "../workflow";
import FilePreview from "./FilePreview";
import FileRow from "./FileRow";
import RunActionForm from "./RunActionForm";
import { Alert, Icon, RoleChip, Spinner, formatDateTime } from "./ui";

/**
 * One run in full. The preview (sample table / PDF / image) is always the main area and
 * always has a real height; the files list and the step-by-step status share a side panel.
 *
 *   large screens : preview on the left, a collapsible "Files | Status" panel on the right
 *   smaller screens: one full-width panel at a time, switched with the Preview / Files /
 *                    Status tabs, and the page scrolls normally.
 */
export default function RunHistory({ runNumber, user, onBack, onChanged, onSilentChange, refreshKey }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  // "preview" | "files" | "status". On large screens the preview is always visible, so
  // "preview" there just means the side panel is showing its default (files).
  const [view, setView] = useState("preview");
  const [sideOpen, setSideOpen] = useState(true);
  const role = user?.role;

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

  // Picking a file on a small screen should take you to it, not leave you on the file list.
  function handlePreview(source) {
    setPreview(source);
    // Only a small screen has a separate Files tab to leave; on a large one the side panel stays put.
    if (!window.matchMedia("(min-width: 1024px)").matches) setView("preview");
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
  // Wet Lab's optional review is actionable too, though the run isn't "awaiting" them.
  const actionable =
    user && (isAwaiting(run, user.role) || (user.role === "wetlab" && wetlabCanReview(run)));
  const stages = visibleStages(role);
  const entriesByStage = {};
  (run.history || []).forEach((h) => {
    (entriesByStage[h.stage_id] ||= []).push(h);
  });
  const allFiles = (run.history || [])
    .filter((entry) => canSeeStage(entry.stage_id, role))
    .flatMap((entry) => (entry.attachments || []).map((attachment) => ({ entry, attachment })));

  const sideView = view === "status" ? "status" : "files";
  const gridCols = sideOpen ? "lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]" : "lg:grid-cols-1";

  const filesPanel = (
    <FilesPanel
      files={allFiles}
      run={run}
      preview={preview}
      role={role}
      onPreview={handlePreview}
      onDeleted={handleFileDeleted}
    />
  );
  const statusPanel = (
    <StatusPanel
      stages={stages}
      run={run}
      currentIdx={currentIdx}
      entriesByStage={entriesByStage}
      preview={preview}
      role={role}
      onPreview={handlePreview}
      onDeleted={handleFileDeleted}
    />
  );

  return (
    <div className="flex flex-col gap-3 sm:gap-4 lg:h-[calc(100dvh-var(--header-h,7.5rem)-3rem)] lg:overflow-hidden">
      {/* Run header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
        <BackButton onBack={onBack} />
        <span className="font-mono text-lg font-extrabold">{run.run_number}</span>
        <span className={`chip ${state.chip}`}>{state.label}</span>
        <span className="text-sm text-slate-500">{stageLabelFor(run, role)}</span>
        {currentVisible && STAGE_BY_ID[run.current_stage]?.role && <RoleChip role={STAGE_BY_ID[run.current_stage]?.role} />}
        <div className="ml-auto flex items-center gap-2">
          {role === "bioinfo_head" && (
            <button
              onClick={handleDeleteRun}
              disabled={deletingRun}
              className="text-xs font-bold text-accent-800 hover:text-accent-900 flex items-center gap-1.5"
              title="Permanently remove this run"
            >
              {deletingRun ? <Spinner /> : <Icon name="x" size={13} strokeWidth={2.4} />}
              <span className="hidden sm:inline">Remove run</span>
            </button>
          )}
          {!sideOpen && (
            <button onClick={() => setSideOpen(true)} className="hidden lg:flex btn-ghost py-1.5 px-3 text-xs" title="Show files and status">
              <Icon name="panelLeft" size={14} />
              Files &amp; status
            </button>
          )}
        </div>
      </div>

      {/* The action itself — Approve/Reject or Upload — sits at the very top, above the
          preview. It's the one thing that matters most when it's your turn. */}
      {actionable && (
        <section className="card p-3.5 border-l-4 border-l-accent-600 shrink-0">
          {!STAGE_BY_ID[run.current_stage]?.review && (
            <header className="mb-3">
              <h2 className="text-base font-bold">
                {STAGE_BY_ID[run.current_stage]?.heading || STAGE_BY_ID[run.current_stage]?.title}
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

      {/* Tabs for screens below lg: one panel at a time */}
      <div className="lg:hidden shrink-0">
        <SegTabs
          value={view}
          onChange={setView}
          tabs={[
            { id: "preview", label: "Preview", icon: "grid" },
            { id: "files", label: "Files", icon: "file", badge: allFiles.length },
            { id: "status", label: "Status", icon: "clock" },
          ]}
        />
      </div>

      <div className={`grid grid-cols-1 gap-4 ${gridCols} lg:grid-rows-[minmax(0,1fr)] lg:flex-1 lg:min-h-0 lg:overflow-hidden`}>
        {/* Main: the preview. A fixed viewport-relative height below lg (so the sample table
            always has room and scrolls inside it), the remaining height on large screens. */}
        <div className={`${view === "preview" ? "block" : "hidden"} lg:block min-w-0 lg:h-full lg:min-h-0`}>
          <div className="h-[calc(100dvh-13rem)] min-h-[26rem] lg:h-full lg:min-h-0">
            <FilePreview source={preview} role={user.role} onClear={() => setPreview(null)} />
          </div>
        </div>

        {/* Side panel: files / status */}
        {sideOpen || view !== "preview" ? (
          <aside
            className={`${view === "preview" ? "hidden" : "block"} ${sideOpen ? "lg:flex" : "lg:hidden"} min-w-0 lg:flex-col lg:h-full lg:min-h-0`}
          >
            <div className="hidden lg:flex items-center gap-2 mb-3 shrink-0">
              <SegTabs
                className="flex-1"
                value={sideView}
                onChange={setView}
                tabs={[
                  { id: "files", label: "Files", icon: "file", badge: allFiles.length },
                  { id: "status", label: "Status", icon: "clock" },
                ]}
              />
              <button
                onClick={() => setSideOpen(false)}
                className="btn-ghost py-2 px-2.5 text-xs shrink-0"
                title="Hide this panel to give the preview more room"
              >
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
            <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
              {/* Below lg the tab already chose the panel; on lg the side tabs do. */}
              <div className="lg:hidden">{view === "status" ? statusPanel : filesPanel}</div>
              <div className="hidden lg:block">{sideView === "status" ? statusPanel : filesPanel}</div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function SegTabs({ tabs, value, onChange, className = "" }) {
  return (
    <div className={`flex items-center gap-1 rounded-xl bg-slate-200/70 p-1 ${className}`} role="tablist">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
              active ? "bg-white text-brand-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.badge > 0 && (
              <span className={`text-[11px] font-extrabold rounded-full px-1.5 min-w-[1.2rem] ${active ? "bg-brand-100 text-brand-800" : "bg-slate-300 text-slate-700"}`}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FilesPanel({ files, run, preview, role, onPreview, onDeleted }) {
  return (
    <section className="card p-4 sm:p-5">
      <header className="mb-3">
        <h2 className="text-base font-bold">Files for this run</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {files.length === 0 ? "Nothing uploaded yet." : `${files.length} file${files.length > 1 ? "s" : ""}. Tap one to preview it.`}
        </p>
      </header>
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(({ entry, attachment }) => (
            <div key={attachment.id}>
              <FileRow
                file={attachment}
                runNumber={run.run_number}
                stageId={entry.stage_id}
                uploadedBy={`${STAGE_BY_ID[entry.stage_id]?.title ?? ""} · ${entry.actor_name}`}
                uploadedAt={entry.created_at}
                onPreview={onPreview}
                active={preview?.attachmentId === attachment.id}
                canDelete={role === "primary_team"}
                onDeleted={onDeleted}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusPanel({ stages, run, currentIdx, entriesByStage, preview, role, onPreview, onDeleted }) {
  return (
    <section className="card p-4 sm:p-5">
      <header className="mb-4">
        <h2 className="text-base font-bold">Status</h2>
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
                <span className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${done ? "bg-brand-500" : "bg-slate-200"}`} />
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
                <span className={`text-sm font-bold ${done || current ? "text-slate-900" : "text-slate-400"}`}>{stage.title}</span>
                {current && <span className="chip bg-accent-100 text-accent-800">Current</span>}
              </div>
              <p className="text-xs text-slate-500 mt-1">{stage.desc}</p>

              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`mt-2.5 rounded-lg border px-3.5 py-3 ${
                    entry.action === "rejected" || entry.action === "reset" ? "bg-accent-200 border-accent-400" : "bg-slate-50 border-slate-200"
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
                  {entry.note && entry.action !== "reset" && <p className="text-sm text-slate-700 mt-1.5">“{entry.note}”</p>}
                  {entry.attachments?.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {entry.attachments.map((a) => (
                        <FileRow
                          key={a.id}
                          file={a}
                          runNumber={run.run_number}
                          stageId={entry.stage_id}
                          onPreview={onPreview}
                          active={preview?.attachmentId === a.id}
                          canDelete={role === "primary_team"}
                          onDeleted={onDeleted}
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
