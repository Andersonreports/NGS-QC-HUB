import { useState } from "react";
import { api } from "../api";
import { ROLES, STAGE_BY_ID, UPLOAD_SLOTS, UPLOAD_ANY_OF, isAwaiting } from "../workflow";
import AttachmentList from "./AttachmentList";
import { Alert, Icon, Spinner, formatBytes } from "./ui";

/** Picks the right action for whatever step a run is sitting on. */
export default function RunActionForm({ run, user, onDone }) {
  const stage = STAGE_BY_ID[run.current_stage];

  if (run.status === "completed") {
    return (
      <Alert kind="success">
        This run is fully approved — the final status has been delivered to the Primary Team.
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
    <ReviewForm run={run} stage={stage} onDone={onDone} />
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

export function ReviewForm({ run, stage, onDone, hideFiles = false }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const noteRequired = stage.role !== "primary_head";

  const latestWithFiles = [...(run.history || [])].reverse().find((h) => h.attachments?.length);

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{stage.desc}</p>
      {error && <Alert kind="error">{error}</Alert>}

      {latestWithFiles && !hideFiles && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            For your review
          </div>
          <AttachmentList runNumber={run.run_number} attachments={latestWithFiles.attachments} />
        </div>
      )}

      <div>
        <label className="label" htmlFor={`review-${run.run_number}`}>
          {noteRequired ? "Note (required to send back)" : "Note (optional — errors are flagged in the Excel)"}
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
