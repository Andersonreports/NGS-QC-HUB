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

// Every column but Sno, Run and Data_received can be corrected by hand — those
// three are either a position, tied to the run's own identity, or the transfer
// date already tracked elsewhere, not something read from the summary tab.
const COLUMNS = [
  { key: "sno", label: "Sno" },
  { key: "run_label", label: "Run" },
  { key: "test", label: "Test", editable: true },
  { key: "number_of_samples", label: "Number of samples", editable: true, numeric: true },
  { key: "rawdata_backup_size", label: "Rawdata backup (Consolidated) size", editable: true },
  { key: "rawdata_backup_drive", label: "Radata Backup drive", editable: true },
  { key: "data_received", label: "Data_received" },
  { key: "shared_to_exome_group", label: "shared to exome group", editable: true },
  { key: "itdose", label: "itdose", editable: true },
  { key: "output_backup_drive", label: "Output Backup drive", editable: true },
  { key: "coverage", label: "Coverage", editable: true },
  { key: "done_by", label: "Done by", editable: true },
];

/**
 * All runs transferred in one calendar month, consolidated into a single table,
 * grouped by the transfer date (a run's created_at, the date Primary Team treats as
 * "received"). Every field but Sno, Run and Data_received comes from that run's
 * consolidated Excel's own "summary" tab by default, matching the reference report
 * format — but Primary Team Head can click any of those cells to correct it by hand
 * when the file is wrong or a field was left blank.
 */
export default function MonthlyReport({ user, onViewRun }) {
  const canDownload = user?.role === "primary_head";
  const canEdit = user?.role === "primary_head";
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

  async function saveCell(runNumber, field, value) {
    const updatedRow = await api.editMonthlyReportCell(runNumber, field, value);
    setReport((current) => {
      if (!current) return current;
      const runs = current.runs.map((r) => (r.run_number === runNumber ? updatedRow : r));
      const sampleCounts = runs.map((r) => r.number_of_samples).filter((n) => typeof n === "number");
      return {
        ...current,
        runs,
        totals: {
          ...current.totals,
          number_of_samples: sampleCounts.length ? sampleCounts.reduce((a, b) => a + b, 0) : null,
        },
      };
    });
  }

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
              Every run transferred in the chosen month, in one table, grouped by the transfer date.
              {canEdit && " Click any cell to correct it."}
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
                <tr className="bg-slate-50 text-center text-xs font-bold uppercase tracking-wide text-slate-500">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-4 py-2.5 whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-center">
                {report.runs.map((r, i) => (
                  <tr key={r.run_number} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 tabular-nums text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono font-bold whitespace-nowrap">
                      <button
                        onClick={() => onViewRun?.(r.run_number)}
                        className="hover:text-brand-800 hover:underline"
                        title={!r.has_summary ? "No \"summary\" tab found in this run's consolidated Excel yet" : "Open this run"}
                      >
                        {r.run_label}
                      </button>
                    </td>
                    <EditableCell value={r.test} editable={canEdit} onSave={(v) => saveCell(r.run_number, "test", v)} />
                    <EditableCell
                      value={r.number_of_samples ?? ""}
                      editable={canEdit}
                      numeric
                      onSave={(v) => saveCell(r.run_number, "number_of_samples", v)}
                    />
                    <EditableCell
                      value={r.rawdata_backup_size}
                      editable={canEdit}
                      onSave={(v) => saveCell(r.run_number, "rawdata_backup_size", v)}
                    />
                    <EditableCell
                      value={r.rawdata_backup_drive}
                      editable={canEdit}
                      onSave={(v) => saveCell(r.run_number, "rawdata_backup_drive", v)}
                    />
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{formatDate(r.data_received)}</td>
                    <EditableCell
                      value={r.shared_to_exome_group}
                      editable={canEdit}
                      onSave={(v) => saveCell(r.run_number, "shared_to_exome_group", v)}
                    />
                    <EditableCell value={r.itdose} editable={canEdit} onSave={(v) => saveCell(r.run_number, "itdose", v)} />
                    <EditableCell
                      value={r.output_backup_drive}
                      editable={canEdit}
                      onSave={(v) => saveCell(r.run_number, "output_backup_drive", v)}
                    />
                    <EditableCell value={r.coverage} editable={canEdit} onSave={(v) => saveCell(r.run_number, "coverage", v)} />
                    <EditableCell value={r.done_by} editable={canEdit} onSave={(v) => saveCell(r.run_number, "done_by", v)} />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold bg-slate-50 text-center">
                  <td className="px-4 py-2.5" colSpan={3}>Total</td>
                  <td className="px-4 py-2.5 tabular-nums">{report.totals.number_of_samples ?? "—"}</td>
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

/** One table cell — plain text normally, an inline input while being edited.
 * Saves on blur or Enter, cancels on Escape. Only rendered editable for Primary
 * Team Head; everyone else just sees the value. */
function EditableCell({ value, editable, numeric, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!editable) {
    return (
      <td className="px-4 py-2.5 whitespace-nowrap">
        {value || <span className="text-slate-400">—</span>}
      </td>
    );
  }

  if (editing) {
    async function commit() {
      const trimmed = draft.trim();
      if (trimmed === String(value ?? "").trim()) {
        setEditing(false);
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await onSave(trimmed);
        setEditing(false);
      } catch (e) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
    }

    return (
      <td className="px-2 py-1.5">
        <input
          autoFocus
          type={numeric ? "number" : "text"}
          className={`w-full min-w-[6rem] border rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 ${
            error ? "border-accent-600 focus:ring-accent-100" : "border-brand-400 focus:ring-brand-100"
          }`}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
        {error && <p className="text-[11px] text-accent-800 mt-0.5">{error}</p>}
      </td>
    );
  }

  return (
    <td
      className="px-4 py-2.5 whitespace-nowrap cursor-text hover:bg-brand-50"
      onClick={() => {
        setDraft(String(value ?? ""));
        setEditing(true);
      }}
      title="Click to edit"
    >
      {value || <span className="text-slate-400">—</span>}
    </td>
  );
}
