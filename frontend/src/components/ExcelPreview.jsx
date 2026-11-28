import { useEffect, useState } from "react";
import { downloadAttachment, fetchAttachmentBlob } from "../api";
import RawSheetTable, { parseWorkbookBlob } from "./RawSheetTable";
import { STAGE_BY_ID } from "../workflow";
import { Alert, Icon, Spinner } from "./ui";

export const isSpreadsheetName = (name = "") => /\.(xlsx|xls|xlsm|csv|tsv)$/i.test(name);

/**
 * Excel view of a run: every spreadsheet file uploaded to it (raw CSV, raw Excel,
 * consolidated Excel …) as a tab, with the data read straight from the file.
 * `files` is [{ entry, attachment }] already filtered to what this viewer may see.
 */
export default function ExcelPreview({ files, runNumber }) {
  const sheets = files.filter(({ attachment }) => isSpreadsheetName(attachment.filename));
  const [activeId, setActiveId] = useState(sheets[0]?.attachment.id ?? null);
  const [state, setState] = useState({ status: "loading" });
  const [expanded, setExpanded] = useState(false); // fill the screen, like the sample table

  const active = sheets.find((f) => f.attachment.id === activeId) || sheets[0];
  const activeKey = active?.attachment.id;

  useEffect(() => {
    if (!activeKey) return;
    let alive = true;
    setState({ status: "loading" });
    fetchAttachmentBlob(runNumber, activeKey)
      .then(parseWorkbookBlob)
      .then((parsed) => alive && setState({ status: "ready", sheets: parsed }))
      .catch((err) => alive && setState({ status: "error", message: err.message }));
    return () => {
      alive = false;
    };
  }, [runNumber, activeKey]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (!sheets.length) {
    return (
      <div className="card h-full min-h-[24rem] flex flex-col items-center justify-center text-center p-8">
        <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
          <Icon name="file" size={24} />
        </div>
        <p className="text-sm font-semibold text-slate-600">No Excel or CSV files yet</p>
        <p className="text-sm text-slate-400 mt-1 max-w-xs">Spreadsheets uploaded to this run will show up here.</p>
      </div>
    );
  }

  return (
    <div className={expanded ? "fixed inset-0 z-40 flex flex-col bg-white" : "card h-full flex flex-col overflow-hidden min-h-[24rem]"}>
      <header className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0">
        <div className="flex gap-1.5 flex-wrap flex-1 min-w-0">
          {sheets.map(({ entry, attachment }) => {
            const on = attachment.id === activeKey;
            return (
              <button
                key={attachment.id}
                onClick={() => setActiveId(attachment.id)}
                aria-pressed={on}
                title={attachment.filename}
                className={`max-w-[16rem] text-left rounded-lg px-3 py-1.5 border transition-colors ${
                  on ? "bg-brand-700 border-brand-700 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-brand-300"
                }`}
              >
                <div className="text-xs font-bold truncate">{attachment.filename}</div>
                <div className={`text-[10px] ${on ? "text-white/80" : "text-slate-400"}`}>{STAGE_BY_ID[entry.stage_id]?.title ?? ""}</div>
              </button>
            );
          })}
        </div>
        <button
          className="btn-ghost py-1.5 px-2.5 text-xs shrink-0"
          onClick={() => downloadAttachment(runNumber, active.attachment.id, active.attachment.filename)}
          title="Download"
        >
          <Icon name="download" size={13} />
        </button>
        <button
          className="btn-ghost py-1.5 px-2.5 text-xs shrink-0 gap-1.5"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Back to the page (Esc)" : "Open full screen for more room"}
          aria-label={expanded ? "Close full screen" : "Full screen"}
        >
          <Icon name={expanded ? "x" : "panelLeft"} size={13} />
          <span className="hidden md:inline">{expanded ? "Close" : "Full screen"}</span>
        </button>
      </header>
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-0 overflow-hidden">
          {state.status === "loading" && (
            <div className="h-full flex items-center justify-center text-brand-700 py-16">
              <Spinner />
            </div>
          )}
          {state.status === "error" && (
            <div className="p-4">
              <Alert kind="error">{state.message}</Alert>
            </div>
          )}
          {state.status === "ready" && <RawSheetTable key={activeKey} sheets={state.sheets} />}
        </div>
      </div>
    </div>
  );
}
