import { useState } from "react";
import { downloadAttachment } from "../api";
import { Icon, formatBytes } from "./ui";

export default function AttachmentList({ runNumber, attachments }) {
  const [error, setError] = useState(null);
  return (
    <div className="space-y-1.5">
      {error && <p className="text-xs text-accent-900">{error}</p>}
      {attachments.map((a) => (
        <button
          key={a.id}
          onClick={async () => {
            try {
              await downloadAttachment(runNumber, a.id, a.filename);
            } catch (err) {
              setError(err.message);
            }
          }}
          className="flex items-center gap-2 text-sm text-brand-800 hover:text-brand-950 hover:underline"
        >
          <Icon name="download" size={14} />
          <span className="font-medium">{a.filename}</span>
          <span className="text-slate-500 text-xs">{formatBytes(a.size_bytes)}</span>
        </button>
      ))}
    </div>
  );
}
