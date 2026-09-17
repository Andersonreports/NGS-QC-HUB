import { useState } from "react";
import { api } from "../api";
import { Icon, Spinner, formatBytes, formatDateTime } from "./ui";

/** A stored file as a clickable row that opens it in the preview pane. Primary Team —
 * the only role that ever uploads a file — can also remove one, for when the wrong
 * file was attached. */
export default function FileRow({
  file, runNumber, stageId, uploadedBy, uploadedAt, onPreview, active, canDelete, onDeleted,
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e) {
    e.stopPropagation();
    if (deleting) return;
    if (!window.confirm(`Remove "${file.filename}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteFile(runNumber, file.id);
      onDeleted?.();
    } catch (err) {
      window.alert(err.message);
      setDeleting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          onPreview({
            kind: "remote",
            runNumber,
            attachmentId: file.id,
            filename: file.filename,
            sizeBytes: file.size_bytes,
            stageId,
          })
        }
        className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border ${
          active
            ? "border-brand-500 bg-brand-50"
            : "border-slate-200 hover:border-brand-400 hover:bg-brand-50/40"
        }`}
      >
        <Icon name="file" size={14} className="text-slate-400 shrink-0" />
        <span className="text-sm font-medium truncate">{file.filename}</span>
        <span className="text-xs text-slate-400 shrink-0">{formatBytes(file.size_bytes)}</span>
        <span className="ml-auto text-xs font-bold text-brand-700 shrink-0">Preview</span>
        {canDelete && (
          <span
            role="button"
            onClick={handleDelete}
            title="Remove this file"
            className="text-slate-400 hover:text-accent-900 shrink-0"
          >
            {deleting ? <Spinner /> : <Icon name="x" size={14} />}
          </span>
        )}
      </button>
      {(uploadedBy || uploadedAt) && (
        <p className="text-[11px] text-slate-400 mt-0.5 pl-3">
          {uploadedBy}
          {uploadedAt && ` · ${formatDateTime(uploadedAt)}`}
        </p>
      )}
    </div>
  );
}
