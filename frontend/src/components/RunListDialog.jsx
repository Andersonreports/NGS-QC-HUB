import { useEffect } from "react";
import { createPortal } from "react-dom";
import { STAGE_BY_ID } from "../workflow";
import { Icon } from "./ui";

/** 2026-04-23 -> 23/04/2026 */
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * The runs behind the "Total runs" card: run number, where it stands, its sample count
 * and the date it was started. Comes straight from the dashboard data, so it always
 * matches the card's number.
 */
export default function RunListDialog({ runs, tone = "violet", onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Rendered on the page body so the overlay covers the sticky header too.
  return createPortal(
    <div
      className={`tone-${tone} fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 p-0 sm:p-6`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Total runs"
        className="bg-white w-full sm:max-w-3xl max-h-[90vh] sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="flex items-start gap-3 px-5 py-4 border-b border-slate-200">
          <span className="w-1 self-stretch rounded-full" style={{ background: "var(--accent)" }} />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-slate-900">Total runs</h2>
            <p className="text-sm text-slate-500">
              {runs.length.toLocaleString()} run{runs.length === 1 ? "" : "s"}
            </p>
          </div>
          <button className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="overflow-auto flex-1">
          {runs.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">No runs to show.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold w-10">#</th>
                  <th className="px-3 py-2.5 font-semibold">Run</th>
                  <th className="px-3 py-2.5 font-semibold">Stage</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Samples</th>
                  <th className="px-3 py-2.5 font-semibold">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r, i) => (
                  <tr key={r.run} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-800 whitespace-nowrap">{r.run}</td>
                    <td className="px-3 py-2.5 text-slate-600">{STAGE_BY_ID[r.stage]?.title || r.stage}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                        {r.status === "completed" ? "Completed" : "In progress"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.samples ?? "-"}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{formatDate(r.created) || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
