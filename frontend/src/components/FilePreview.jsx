import { useEffect, useMemo, useRef, useState } from "react";
import { downloadAttachment, fetchAttachmentBlob } from "../api";
import RawSheetTable, { parseWorkbookBlob } from "./RawSheetTable";
import SheetGrid from "./SheetGrid";
import { Alert, Icon, Spinner, formatBytes } from "./ui";

function extOf(name = "") {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * Right-hand preview pane. `source` is either a file the user just picked
 * ({ kind: "local", file }) or one already uploaded
 * ({ kind: "remote", runNumber, attachmentId, filename, sizeBytes, stageId }).
 * The consolidated Excel (stageId "excel_uploaded") renders as a live, shared,
 * editable spreadsheet instead of a static preview — see SheetGrid.
 */
export default function FilePreview({ source, role, onClear }) {
  const [state, setState] = useState({ status: "idle" });
  const objectUrlRef = useRef(null);
  const isConsolidatedSheet = source?.kind === "remote" && source.stageId === "excel_uploaded";

  const meta = useMemo(() => {
    if (!source) return null;
    if (source.kind === "local") {
      return { name: source.file.name, size: source.file.size, ext: extOf(source.file.name) };
    }
    return { name: source.filename, size: source.sizeBytes, ext: extOf(source.filename) };
  }, [source]);

  useEffect(() => {
    let alive = true;
    if (isConsolidatedSheet) {
      setState({ status: "live-sheet" });
      return () => {
        alive = false;
      };
    }

    function revoke() {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    }

    if (!source) {
      revoke();
      setState({ status: "idle" });
      return;
    }

    revoke();
    setState({ status: "loading" });

    (async () => {
      try {
        const blob =
          source.kind === "local"
            ? source.file
            : await fetchAttachmentBlob(source.runNumber, source.attachmentId);
        if (!alive) return;

        const ext = meta.ext;

        if (ext === "pdf") {
          const url = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
          objectUrlRef.current = url;
          setState({ status: "pdf", url });
          return;
        }

        if (["xlsx", "xls", "xlsm", "csv", "txt", "tsv"].includes(ext)) {
          const sheets = await parseWorkbookBlob(blob);
          if (!alive) return;
          setState({ status: "sheet", sheets });
          return;
        }

        if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setState({ status: "image", url });
          return;
        }

        setState({ status: "unsupported" });
      } catch (err) {
        if (alive) setState({ status: "error", message: err.message });
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.kind, source?.attachmentId, source?.file, source?.stageId, meta?.name]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  if (!source) {
    return (
      <div className="card h-full flex flex-col items-center justify-center text-center p-8 min-h-[24rem]">
        <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
          <Icon name="file" size={24} />
        </div>
        <p className="text-sm font-semibold text-slate-600">Nothing selected</p>
        <p className="text-sm text-slate-400 mt-1 max-w-xs">
          Pick a file to upload, or click one already uploaded, and it will preview here.
        </p>
      </div>
    );
  }

  return (
    <div className="card h-full flex flex-col overflow-hidden min-h-[24rem]">
      {state.status !== "live-sheet" && (
        <header className="px-4 py-3 border-b border-slate-200 flex items-center gap-2.5 shrink-0">
          <Icon name="file" size={15} className="text-slate-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate" title={meta.name}>{meta.name}</div>
            <div className="text-[11px] text-slate-400">
              {source.kind === "local" ? "Selected — not uploaded yet" : `Uploaded · run ${source.runNumber}`}
              {meta.size != null && ` · ${formatBytes(meta.size)}`}
            </div>
          </div>
          {source.kind === "remote" && (
            <button
              className="btn-ghost py-1.5 px-2.5 text-xs shrink-0"
              onClick={() => downloadAttachment(source.runNumber, source.attachmentId, source.filename)}
              title="Download"
            >
              <Icon name="download" size={13} />
            </button>
          )}
          {onClear && (
            <button className="text-slate-400 hover:text-slate-700 shrink-0" onClick={onClear} title="Close preview">
              <Icon name="x" size={15} />
            </button>
          )}
        </header>
      )}

      {/* overflow-hidden here on purpose: each branch below owns exactly one bounded
          scroll region (h-full + its own overflow-auto) instead of nesting two, which
          is what put the sheet's horizontal scrollbar below the last row instead of
          inside the visible viewport. */}
      <div className="flex-1 overflow-hidden">
        {state.status === "loading" && (
          <div className="h-full flex items-center justify-center text-brand-700 py-16">
            <Spinner />
          </div>
        )}

        {state.status === "error" && (
          <div className="h-full overflow-auto p-4">
            <Alert kind="error">{state.message}</Alert>
          </div>
        )}

        {state.status === "pdf" && (
          // #navpanes=0 keeps the thumbnail/outline sidebar closed and #toolbar=0
          // hides the built-in viewer's own toolbar (page controls, zoom, the file's
          // internal blob-URL "filename") — our own header above already covers that.
          <iframe
            title={meta.name}
            src={`${state.url}#navpanes=0&toolbar=0&view=FitH`}
            className="w-full h-full min-h-[32rem] border-0"
          />
        )}

        {state.status === "image" && (
          <div className="h-full overflow-auto p-4">
            <img src={state.url} alt={meta.name} className="max-w-full mx-auto" />
          </div>
        )}

        {state.status === "sheet" && <RawSheetTable sheets={state.sheets} />}

        {state.status === "live-sheet" && (
          <SheetGrid
            runNumber={source.runNumber}
            role={role}
            fileMeta={meta}
            onDownload={() => downloadAttachment(source.runNumber, source.attachmentId, source.filename)}
            onClear={onClear}
          />
        )}

        {state.status === "unsupported" && (
          <div className="h-full overflow-auto p-4">
            <Alert kind="info">
              No inline preview for <span className="font-mono">.{meta.ext || "?"}</span> files.
              {source.kind === "remote" && " Use the download button above."}
            </Alert>
          </div>
        )}
      </div>
    </div>
  );
}

