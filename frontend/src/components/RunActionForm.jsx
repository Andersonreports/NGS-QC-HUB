import { useEffect, useState } from "react";
import { api } from "../api";
import { ROLES, STAGE_BY_ID, UPLOAD_SLOTS, UPLOAD_ANY_OF, isAwaiting } from "../workflow";
import AttachmentList from "./AttachmentList";
import FileRow from "./FileRow";
import FilePreview from "./FilePreview";
import { Alert, Icon, Spinner, formatBytes } from "./ui";

/** Picks the right action for whatever step a run is sitting on. `inlinePreview`
 * lets the file(s) up for review be previewed right here — used from the compact
 * "Action Required" list so reviewing doesn't require opening the full run page.
 * `compact` is for the run page's own top action bar, where a full-size preview
 * already sits right below — so the form skips repeating the file and trims down
 * to just what's needed to act. */
export default function RunActionForm({ run, user, onDone, inlinePreview = false, compact = false }) {
  const stage = STAGE_BY_ID[run.current_stage];

  if (run.status === "completed") {
    return (
      <Alert kind="success">
        This run is fully approved. The final status has been delivered to the Primary Team.
      </Alert>
    );
  }

  if (!isAwaiting(run, user.role)) {
    return (
      <Alert kind="info">
        <span className="font-semibold">{stage.title}</span> is with{" "}
        <span className="font-semibold">{ROLES[stage.role]?.label}</span>.
        You'll be notified when it reaches your team.
      </Alert>
    );
  }

  return stage.review ? (
    <ReviewForm run={run} stage={stage} user={user} onDone={onDone} inlinePreview={inlinePreview} hideFiles={compact} compact={compact} />
  ) : (
    <UploadForm run={run} stage={stage} onDone={onDone} />
  );
}

export function UploadForm({ run, stage, onDone }) {
  const slots = UPLOAD_SLOTS[stage.id] || [];
  const [files, setFiles] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isReupload =
    run.awaiting_reupload &&
    (stage.id === "excel_uploaded" || stage.id === "pdf_uploaded");

  const anyOf = UPLOAD_ANY_OF.has(stage.id);
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
      onDone(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">{stage.desc}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {isReupload && (
        <Alert kind="warn">
          Upload the corrected file to replace the current {stage.id === "excel_uploaded" ? "Excel" : "PDF"}.
          The original and re-upload timestamps will remain in the history.
        </Alert>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {slots.map((slot) => (
          <FilePicker
            key={slot.key}
            id={`${run.run_number}-${slot.key}`}
            slot={slot}
            file={files[slot.key]}
            onPick={(file) => setFiles((f) => ({ ...f, [slot.key]: file }))}
          />
        ))}
      </div>

      <div>
        <label className="label" htmlFor={`note-${run.run_number}`}>{isReupload ? "Additional comment (optional)" : "Note (optional)"}</label>
        <textarea
          id={`note-${run.run_number}`}
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
          {busy ? "Uploading…" : isReupload ? `Re-upload ${stage.id === "excel_uploaded" ? "Excel" : "PDF"}` : stage.action || "Submit"}
        </button>
        {missing.length > 0 && (
          <span className="text-xs text-slate-500">
            Attach {missing.map((m) => m.label.toLowerCase()).join(anyOf ? " or " : " and ")} to continue.
          </span>
        )}
      </div>
    </form>
  );
}

export function FilePicker({ id, slot, file, onPick }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{slot.label}</label>
      <input
        id={id}
        type="file"
        accept={slot.accept}
        onChange={(e) => onPick(e.target.files?.[0] || null)}
        className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-3.5
                   file:rounded-lg file:border-0 file:text-sm file:font-semibold
                   file:bg-brand-50 file:text-brand-800 hover:file:bg-brand-100 cursor-pointer
                   border border-slate-300 rounded-lg p-1.5"
      />
      {file && (
        <p className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
          <Icon name="file" size={12} />
          {file.name} · {formatBytes(file.size)}
        </p>
      )}
    </div>
  );
}

export function ReviewForm({ run, stage, user, onDone, hideFiles = false, inlinePreview = false, compact = false }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const noteRequired = stage.role !== "primary_head";

  const latestWithFiles = [...(run.history || [])].reverse().find((h) => h.attachments?.length);

  // Land straight on the file that needs reviewing — no click required — so
  // approving/rejecting from the compact "Action Required" list doesn't force a
  // trip to the full run page just to see what's in it.
  useEffect(() => {
    if (!inlinePreview || !latestWithFiles?.attachments?.length) return;
    const first = latestWithFiles.attachments[0];
    setPreview({
      kind: "remote",
      runNumber: run.run_number,
      attachmentId: first.id,
      filename: first.filename,
      sizeBytes: first.size_bytes,
      stageId: latestWithFiles.stage_id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlinePreview, latestWithFiles?.id]);

  async function act(action) {
    if (action === "rejected" && noteRequired && !note.trim()) {
      setError("Please add a note explaining what needs to change.");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const updated = await api.advanceRun(run.run_number, { note, action });
      setNote("");
      onDone(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (compact) {
    // Nothing but what's needed to act: the file it's about, a note (optional
    // unless rejecting), Approve/Reject — no heading, no restated instructions.
    // The actual preview already sits right below on this page.
    return (
      <div className="space-y-2">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-2.5">
          {latestWithFiles?.attachments?.[0] && (
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 min-w-0 shrink-0 max-w-[16rem]">
              <Icon name="file" size={14} className="text-slate-400 shrink-0" />
              <span className="truncate">{latestWithFiles.attachments[0].filename}</span>
            </div>
          )}
          <input
            className="field flex-1 min-w-[10rem] py-1.5 text-sm"
            placeholder={noteRequired ? "Note (required to send back)" : "Note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn-success py-1.5 px-3 text-sm shrink-0" onClick={() => act("approved")} disabled={busy !== null}>
            {busy === "approved" ? <Spinner /> : <Icon name="check" size={14} strokeWidth={2.4} />}
            Approve
          </button>
          <button className="btn-danger py-1.5 px-3 text-sm shrink-0" onClick={() => act("rejected")} disabled={busy !== null}>
            {busy === "rejected" ? <Spinner /> : <Icon name="x" size={14} strokeWidth={2.4} />}
            Request changes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{stage.desc}</p>
      {error && <Alert kind="error">{error}</Alert>}

      {latestWithFiles && !hideFiles && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            For your review
          </div>
          {inlinePreview ? (
            <div className="space-y-2">
              {latestWithFiles.attachments.length > 1 && (
                <div className="space-y-1.5">
                  {latestWithFiles.attachments.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      runNumber={run.run_number}
                      stageId={latestWithFiles.stage_id}
                      onPreview={setPreview}
                      active={preview?.attachmentId === file.id}
                    />
                  ))}
                </div>
              )}
              <div className="h-[26rem]">
                <FilePreview source={preview} role={user?.role} onClear={null} />
              </div>
            </div>
          ) : (
            <AttachmentList runNumber={run.run_number} attachments={latestWithFiles.attachments} />
          )}
        </div>
      )}

      <div>
        <label className="label" htmlFor={`review-${run.run_number}`}>
          {noteRequired ? "Note (required to send back)" : "Note (optional; errors are flagged in the Excel)"}
        </label>
        <textarea
          id={`review-${run.run_number}`}
          className="field"
          rows={2}
          placeholder={noteRequired ? "Add your review comments…" : "Add any additional context…"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2.5">
        <button className="btn-success" onClick={() => act("approved")} disabled={busy !== null}>
          {busy === "approved" ? <Spinner /> : <Icon name="check" size={15} strokeWidth={2.4} />}
          Approve
        </button>
        <button className="btn-danger" onClick={() => act("rejected")} disabled={busy !== null}>
          {busy === "rejected" ? <Spinner /> : <Icon name="x" size={15} strokeWidth={2.4} />}
          Request changes
        </button>
      </div>
    </div>
  );
}
