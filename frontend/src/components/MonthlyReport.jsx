import { useEffect, useState } from "react";
import { api, downloadMonthlyReport } from "../api";
import { Alert, Icon, Spinner } from "./ui";

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(iso) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const COLUMNS = [
  { key: "sno", label: "Sno", align: "text-right" },
  { key: "run_label", label: "Run" },
  { key: "test", label: "Test" },
  { key: "number_of_samples", label: "Number of samples", align: "text-right" },
  { key: "rawdata_backup_size", label: "Rawdata backup (Consolidated) size" },
  { key: "rawdata_backup_drive", label: "Radata Backup drive" },
  { key: "data_received", label: "Data_received" },
  { key: "shared_to_exome_group", label: "shared to exome group" },
  { key: "itdose", label: "itdose" },
  { key: "output_backup_drive", label: "Output Backup drive" },
  { key: "coverage", label: "Coverage" },
  { key: "done_by", label: "Done by" },
];

/**
 * All runs transferred in one calendar month, consolidated into a single table —
 * grouped by the transfer date (a run's created_at, the date Primary Team treats as
 * "received"). Every field but Sno and Data_received comes straight from that run's
 * consolidated Excel's own "summary" tab, matching the reference report format;
 * Data_received is the transfer date already tracked here, and Sno is just the row's
 * position in this table.
 */
export default function MonthlyReport({ user, onViewRun }) {
  const canDownload = user?.role === "primary_team";
  const [ym, setYm] = useState(currentYearMonth());
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!ym) return;
    const [year, month] = ym.split("-").map(Number);
    let alive = true;
    setReport(null);
    setError(null);
    api
      .getMonthlyReport(year, month)
      .then((d) => alive && setReport(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [ym]);

  const monthLabel = ym
    ? new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <header className="p-5 pb-4 flex flex-wrap items-center gap-3 border-b border-slate-200">
          <div className="flex-1 min-w-[14rem]">
            <h2 className="text-base font-bold">Monthly consolidated report</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Every run transferred in the chosen month, in one table — grouped by the transfer date.
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            Month
            <input
              type="month"
              className="field w-auto py-1.5 text-sm"
              value={ym}
              onChange={(e) => setYm(e.target.value)}
            />
          </label>
          {canDownload && (
            <button
              className="btn-primary py-1.5 px-3 text-xs"
              disabled={!report || report.runs.length === 0 || exporting}
              onClick={async () => {
                const [year, month] = ym.split("-").map(Number);
                setExporting(true);
                try {
                  await downloadMonthlyReport(year, month);
                } catch (e) {
                  setError(e.message);
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? <Spinner /> : <Icon name="download" size={13} />}
              Download .xlsx
            </button>
          )}
        </header>

        {error && (
          <div className="p-5">
            <Alert kind="error">{error}</Alert>
          </div>
        )}

        {!report && !error ? (
          <div className="p-8 flex justify-center text-brand-700">
            <Spinner />
          </div>
        ) : report && report.runs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No runs were transferred in {monthLabel}.
          </p>
        ) : report ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`px-4 py-2.5 whitespace-nowrap ${c.align || ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.runs.map((r, i) => (
                  <tr
                    key={r.run_number}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => onViewRun?.(r.run_number)}
                    title={!r.has_summary ? "No \"summary\" tab found in this run's consolidated Excel yet" : undefined}
                  >
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono font-bold whitespace-nowrap">{r.run_label}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.test || (!r.has_summary && <span className="text-slate-400">—</span>)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.number_of_samples ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.rawdata_backup_size || <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.rawdata_backup_drive}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{formatDate(r.data_received)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.shared_to_exome_group}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.itdose}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.output_backup_drive}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.coverage}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{r.done_by}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold bg-slate-50">
                  <td className="px-4 py-2.5" colSpan={3}>Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{report.totals.number_of_samples ?? "—"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap" colSpan={8}>{report.totals.rawdata_backup_size ?? ""}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
