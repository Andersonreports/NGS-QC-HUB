import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { PRIMARY_TEAM_UPLOADS, ROLES, STAGE_BY_ID, STAGE_INDEX, UPLOAD_SLOTS, UPLOAD_ANY_OF, canSeeStage } from "../workflow";
import FilePreview from "./FilePreview";
import { Alert, Icon, Spinner, StatusChip, formatBytes, formatDateTime } from "./ui";

const REVIEW_ORDER = ["primary_head_review", "wetlab_qc_review", "bioinfo_review"];

/**
 * One screen: the three hierarchical uploads on the left, a live preview of whatever
 * file is selected on the right. A later upload only unlocks once the earlier one is
 * done — and the PDF only once the consolidated Excel has all three approvals.
 */
export default function UploadWorkspace({ user, onChanged, onViewRun }) {
  const [runNumber, setRunNumber] = useState("");
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const load = useCallback(async (number) => {
    const value = (number ?? runNumber).trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      setRun(await api.getRun(value));
    } catch (err) {
      setRun(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [runNumber]);

  return (
    <div className={sidebarOpen ? "grid gap-4 items-start lg:grid-cols-2 xl:grid-cols-[minmax(20rem,1fr)_3fr]" : "grid gap-4"}>
      {/* ---------------- left: uploads ---------------- */}
      {sidebarOpen && (
      <div className="min-w-0 space-y-4">
        <section className="card p-5">
          <header className="mb-4 flex items-start gap-3">
            <div className="flex-1">
              <h2 className="text-base font-bold">Run uploads</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Enter the run number Wet Lab marked as transferred, then work down the three uploads in
                order.
              </p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="btn-ghost py-1.5 px-2.5 text-xs shrink-0"
              title="Hide this panel — give the preview more room"
            >
              <Icon name="chevronLeft" size={14} />
            </button>
          </header>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              load();
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <div className="flex-1">
              <label className="label" htmlFor="ws-run">Run number</label>
              <input
                id="ws-run"
                className="field font-mono"
                placeholder="e.g. RUN-045"
                value={runNumber}
                onChange={(e) => setRunNumber(e.target.value)}
              />
            </div>
            <div className="sm:self-end flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy || !runNumber.trim()}>
                {busy ? <Spinner /> : <Icon name="search" size={15} />}
                Load run
              </button>
              {(run || error) && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setRun(null);
                    setRunNumber("");
                    setError(null);
                    setPreview(null);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {error && (
            <div className="mt-4">
              <Alert kind="error">{error}</Alert>
            </div>
          )}
        </section>

        {run && (
          <>
            <section className="card p-4 flex flex-wrap items-center gap-2.5">
              <span className="font-mono font-bold">{run.run_number}</span>
              <StatusChip run={run} />
              <span className="text-sm text-slate-600">
                {STAGE_BY_ID[run.current_stage].title}
              </span>
              <button
                className="ml-auto text-xs font-bold text-brand-700 hover:text-brand-900"
                onClick={() => onViewRun(run.run_number)}
              >
                Full history →
              </button>
            </section>

            {PRIMARY_TEAM_UPLOADS.filter((stageId) => canSeeStage(stageId, user.role)).map((stageId, i) => (
              <UploadStep
                key={stageId}
                index={i + 1}
                stageId={stageId}
                run={run}
                user={user}
                onPreview={setPreview}
                onUploaded={(updated) => {
                  setRun(updated);
                  setPreview(null);
                  onChanged?.();
                }}
              />
            ))}
          </>
        )}

        {!run && !error && (
          <RecentFiles
            role={user.role}
            onPreview={setPreview}
            onOpenRun={(number) => {
              setRunNumber(number);
              load(number);
            }}
          />
        )}
      </div>
      )}

      {/* ---------------- right: preview ---------------- */}
      <div className="min-w-0 lg:sticky lg:top-[calc(var(--header-h,7.5rem)+1rem)] lg:h-[calc(100vh-var(--header-h,7.5rem)-2rem)]">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="mb-2 btn-ghost py-1.5 px-3 text-xs"
            title="Show run uploads"
          >
            <Icon name="chevronRight" size={14} />
            Show uploads
          </button>
        )}
        <FilePreview source={preview} role={user.role} onClear={() => setPreview(null)} />
      </div>
    </div>
  );
}

/** Shows one run's uploaded files at a time — defaulting to the most recently
 * completed run — instead of every run's files stacked in one long scroll. Picking
 * a different run from the dropdown swaps the list in place. */
function RecentFiles({ onPreview, onOpenRun, role }) {
  const [runs, setRuns] = useState(null);
  const [runsError, setRunsError] = useState(null);
  const [selectedRun, setSelectedRun] = useState("");
  const [files, setFiles] = useState(null);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .listRuns()
      .then((d) => {
        if (!alive) return;
        setRuns(d);
        const sorted = [...d].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        const defaultRun = sorted.find((r) => r.status === "completed") || sorted[0];
        if (defaultRun) setSelectedRun(defaultRun.run_number);
      })
      .catch((e) => alive && setRunsError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedRun) {
      setFiles([]);
      return;
    }
    let alive = true;
    setFiles(null);
    api
      .listFiles(selectedRun)
      .then((d) => alive && setFiles(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [selectedRun]);

  const sortedRuns = [...(runs || [])].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  async function handleDelete(f) {
    if (deletingId) return;
    if (!window.confirm(`Remove "${f.filename}"? This can't be undone.`)) return;
    setDeletingId(f.id);
    try {
      await api.deleteFile(f.run_number, f.id);
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    } catch (e) {
      window.alert(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="card overflow-hidden">
      <header className="p-5 pb-3 flex flex-wrap items-center gap-3 border-b border-slate-200">
        <div className="flex-1 min-w-[12rem]">
          <h2 className="text-base font-bold">Uploaded files</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {files ? `${files.length} file(s) for ${selectedRun || "this run"}` : "Loading…"}
          </p>
        </div>
        {sortedRuns.length > 0 && (
          <select
            className="field w-auto text-sm py-1.5"
            value={selectedRun}
            onChange={(e) => setSelectedRun(e.target.value)}
          >
            {sortedRuns.map((r) => (
              <option key={r.id} value={r.run_number}>
                {r.run_number}
                {r.status === "completed" ? " · Completed" : ""}
              </option>
            ))}
          </select>
        )}
      </header>

      {(error || runsError) && (
        <div className="p-5">
          <Alert kind="error">{error || runsError}</Alert>
        </div>
      )}

      {!runs || !files ? (
        <div className="p-8 flex justify-center text-brand-700">
          <Spinner />
        </div>
      ) : sortedRuns.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          No runs yet. They appear here once Wet Lab records a transfer.
        </p>
      ) : (
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <button
              onClick={() => onOpenRun(selectedRun)}
              className="font-mono font-bold text-sm hover:text-brand-800 hover:underline"
            >
              {selectedRun}
            </button>
            <span className="chip bg-slate-100 text-slate-600">{files.length} file(s)</span>
            <button
              onClick={() => onOpenRun(selectedRun)}
              className="ml-auto text-xs font-bold text-brand-700 hover:text-brand-900"
            >
              Open uploads →
            </button>
          </div>
          {files.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-slate-500">
              No files uploaded yet for this run.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[28rem] overflow-y-auto">
              {files.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() =>
                      onPreview({
                        kind: "remote",
                        runNumber: f.run_number,
                        attachmentId: f.id,
                        filename: f.filename,
                        sizeBytes: f.size_bytes,
                        stageId: f.stage_id,
                      })
                    }
                    className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-brand-400 hover:bg-brand-50/40"
                  >
                    <Icon name="file" size={14} className="text-slate-400 shrink-0" />
                    <span className="text-sm font-medium truncate flex-1 min-w-0" title={f.filename}>
                      {f.filename}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">{formatBytes(f.size_bytes)}</span>
                    <span className="text-xs text-slate-400 shrink-0 hidden lg:inline">
                      {STAGE_BY_ID[f.stage_id]?.title ?? ""}
                    </span>
                    {role === "primary_team" && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(f);
                        }}
                        title="Remove this file"
                        className="text-slate-400 hover:text-red-700 shrink-0"
                      >
                        {deletingId === f.id ? <Spinner /> : <Icon name="x" size={14} />}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Work out whether a step is done, open for upload, or still locked — and why. */
function stepStatus(stageId, run) {
  if (run.status === "completed") return { state: "done" };
  const runIdx = STAGE_INDEX[run.current_stage];
  const stepIdx = STAGE_INDEX[stageId];
  if (runIdx > stepIdx) return { state: "done" };
  if (runIdx === stepIdx) return { state: "open" };

  // Locked — explain what has to happen first.
  if (stageId === "excel_uploaded") {
    return {
      state: "locked",
      reason: "Upload the raw CSV and Excel for this run first.",
    };
  }

  if (stageId === "pdf_uploaded") {
    if (runIdx < STAGE_INDEX["primary_head_review"]) {
      return { state: "locked", reason: "Upload the consolidated Excel and get it approved first." };
    }
    const approved = new Set(
      (run.history || []).filter((h) => h.action === "approved").map((h) => h.stage_id)
    );
    const waiting = REVIEW_ORDER.filter((s) => !approved.has(s));
    return {
      state: "locked",
      reason: "The consolidated Excel needs all three approvals first.",
      approvals: REVIEW_ORDER.map((s) => ({
        stageId: s,
        role: STAGE_BY_ID[s].role,
        done: approved.has(s),
        current: run.current_stage === s,
      })),
      waiting,
    };
  }

  return { state: "locked", reason: "An earlier step is still open." };
}

function UploadStep({ index, stageId, run, user, onPreview, onUploaded }) {
  const stage = STAGE_BY_ID[stageId];
  const slots = UPLOAD_SLOTS[stageId] || [];
  const status = stepStatus(stageId, run);
  const canAct = status.state === "open" && user.role === "primary_team";
  const isReupload =
    canAct &&
    run.awaiting_reupload &&
    (stageId === "excel_uploaded" || stageId === "pdf_uploaded");

  const [files, setFiles] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Files already stored for this step.
  const uploaded = (run.history || [])
    .filter((h) => h.stage_id === stageId)
    .flatMap((h) => (h.attachments || []).map((a) => ({ ...a, entry: h })));

  const anyOf = UPLOAD_ANY_OF.has(stageId);
  const missing = anyOf
    ? (slots.some((s) => files[s.key]) ? [] : slots)
    : slots.filter((s) => !files[s.key]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.advanceRun(run.run_number, {
        note,
        files: slots.map((s) => files[s.key]).filter(Boolean),
      });
      setFiles({});
      setNote("");
      onUploaded(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const tone =
    status.state === "done"
      ? { border: "border-l-emerald-600", badge: "bg-emerald-100 text-emerald-800", icon: "check" }
      : status.state === "open"
      ? { border: "border-l-accent-600", badge: "bg-accent-100 text-accent-700", icon: "upload" }
      : { border: "border-l-slate-300", badge: "bg-slate-100 text-slate-500", icon: "clock" };

  return (
    <section className={`card border-l-4 ${tone.border} p-5`}>
      <header className="flex items-start gap-3 mb-3">
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${tone.badge}`}
        >
          {status.state === "done" ? <Icon name="check" size={14} strokeWidth={2.6} /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">{stage.heading || stage.title}</h3>
            {status.state === "done" && <span className="chip bg-emerald-100 text-emerald-800">Uploaded</span>}
            {status.state === "open" && (
              <span className={`chip ${isReupload ? "bg-red-100 text-red-800" : "bg-accent-100 text-accent-700"}`}>
                {isReupload ? "Re-upload required" : "Ready to upload"}
              </span>
            )}
            {status.state === "locked" && (
              <span className="chip bg-slate-100 text-slate-500">Locked</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">{stage.desc}</p>
        </div>
      </header>

      {/* already-uploaded files, clickable to preview */}
      {uploaded.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {uploaded.map((a) => (
            <li key={a.id}>
              <button
                onClick={() =>
                  onPreview({
                    kind: "remote",
                    runNumber: run.run_number,
                    attachmentId: a.id,
                    filename: a.filename,
                    sizeBytes: a.size_bytes,
                    stageId,
                  })
                }
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-brand-400 hover:bg-brand-50/40"
              >
                <Icon name="file" size={14} className="text-slate-400 shrink-0" />
                <span className="text-sm font-medium truncate">{a.filename}</span>
                <span className="text-xs text-slate-400 shrink-0">{formatBytes(a.size_bytes)}</span>
                <span className="ml-auto text-xs font-bold text-brand-700 shrink-0">Preview</span>
              </button>
              <p className="text-[11px] text-slate-400 mt-0.5 pl-3">
                {a.entry.actor_name} · {formatDateTime(a.entry.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {status.state === "locked" && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-3">
          <p className="text-sm text-slate-600 flex items-start gap-2">
            <Icon name="clock" size={15} className="text-slate-400 mt-0.5 shrink-0" />
            {status.reason}
          </p>
          {status.approvals && (
            <ul className="mt-2.5 space-y-1 pl-6">
              {status.approvals.map((a) => (
                <li key={a.stageId} className="flex items-center gap-2 text-xs">
                  {a.done ? (
                    <Icon name="check" size={13} className="text-emerald-600" strokeWidth={2.4} />
                  ) : (
                    <span
                      className={`w-3 h-3 rounded-full border-2 ${
                        a.current ? "border-amber-500" : "border-slate-300"
                      }`}
                    />
                  )}
                  <span className={a.done ? "text-slate-600" : "font-semibold text-slate-700"}>
                    {ROLES[a.role]?.label}
                  </span>
                  <span className="text-slate-400">
                    {a.done ? "approved" : a.current ? "reviewing now" : "pending"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status.state === "open" && !canAct && (
        <Alert kind="info">
          This upload is the Primary Team's step — you can preview the files but not upload.
        </Alert>
      )}

      {canAct && (
        <form onSubmit={submit} className="space-y-3">
          {error && <Alert kind="error">{error}</Alert>}
          {isReupload && (
            <Alert kind="warn">
              Upload the corrected file. It replaces the previous {stageId === "excel_uploaded" ? "Excel" : "PDF"};
              both upload timestamps remain in the run history.
            </Alert>
          )}

          {slots.map((slot) => (
            <div key={slot.key}>
              <label className="label" htmlFor={`ws-${stageId}-${slot.key}`}>{slot.label}</label>
              <input
                id={`ws-${stageId}-${slot.key}`}
                type="file"
                accept={slot.accept}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setFiles((f) => ({ ...f, [slot.key]: file }));
                  if (file) onPreview({ kind: "local", file });
                }}
                className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-3.5
                           file:rounded-lg file:border-0 file:text-sm file:font-semibold
                           file:bg-brand-50 file:text-brand-800 hover:file:bg-brand-100 cursor-pointer
                           border border-slate-300 rounded-lg p-1.5"
              />
              {files[slot.key] && (
                <button
                  type="button"
                  onClick={() => onPreview({ kind: "local", file: files[slot.key] })}
                  className="mt-1 text-xs text-brand-700 font-semibold hover:text-brand-900 flex items-center gap-1.5"
                >
                  <Icon name="file" size={12} />
                  {files[slot.key].name} · {formatBytes(files[slot.key].size)} — preview
                </button>
              )}
            </div>
          ))}

          <div>
            <label className="label" htmlFor={`ws-note-${stageId}`}>{isReupload ? "Additional comment (optional)" : "Note (optional)"}</label>
            <textarea
              id={`ws-note-${stageId}`}
              className="field"
              rows={2}
              placeholder="Anything the next team should know…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={busy || missing.length > 0}>
              {busy ? <Spinner /> : <Icon name="upload" size={15} />}
              {busy ? "Uploading…" : isReupload ? `Re-upload ${stageId === "excel_uploaded" ? "Excel" : "PDF"}` : stage.action}
            </button>
            {missing.length > 0 && (
              <span className="text-xs text-slate-500">
                Attach {missing.map((m) => m.label.toLowerCase()).join(anyOf ? " or " : " and ")}.
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
