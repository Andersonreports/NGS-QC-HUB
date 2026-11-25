import { useEffect, useMemo, useState } from "react";
import { api, downloadQCReport } from "../api";
import { Alert, Icon, Spinner } from "./ui";

// Columns ticked by default; everything else is opt-in. Compared ignoring case and punctuation.
const DEFAULT_COLUMNS = ["sno", "sampleid", "samplename", "description", "genid", "test", "client", "qcstatus"];
const label = (c) => (c === "Description" ? "Anderson ID" : c);
const norm = (c) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
const isDefault = (c) => DEFAULT_COLUMNS.includes(norm(c));

/**
 * QC Report (Primary Team Head / Bioinfo Team Head only — the server enforces it too).
 * Step 1: tick the runs. Step 2: choose which sample-level columns from inside those
 * runs (Sample_ID, Gen_ID, Test, QC Status, ...) go in the PDF — the key sample details start ticked.
 * The PDF then has one section per run with a row per sample.
 */
export default function QCReport({ onViewRun }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [selectedRuns, setSelectedRuns] = useState(() => new Set());
  // The user's explicit ticks/unticks (column -> bool); anything not in here follows the
  // default, including columns that only appear after they tick another run.
  const [overrides, setOverrides] = useState(() => new Map());
  const isOn = (c) => (overrides.has(c) ? overrides.get(c) : isDefault(c));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getQCReportRuns()
      .then((d) => alive && setRuns(d.runs))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // Union of the sample columns across the ticked runs, in first-seen order.
  const columns = useMemo(() => {
    const seen = new Set();
    (runs ?? []).forEach((r) => {
      if (selectedRuns.has(r.run_number)) r.columns.forEach((c) => seen.add(c));
    });
    return [...seen];
  }, [runs, selectedRuns]);

  const chosenCols = columns.filter(isOn);

  const visibleRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs ?? [];
    return (runs ?? []).filter((r) =>
      [r.run_number, r.status, r.current_stage, r.transferred].some((v) => String(v).toLowerCase().includes(q))
    );
  }, [runs, query]);

  const allVisibleSelected = visibleRuns.length > 0 && visibleRuns.every((r) => selectedRuns.has(r.run_number));
  const totalSamples = (runs ?? []).filter((r) => selectedRuns.has(r.run_number)).reduce((a, r) => a + r.sample_count, 0);

  function toggleRun(n) {
    setSelectedRuns((s) => {
      const next = new Set(s);
      if (!next.delete(n)) next.add(n);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelectedRuns((s) => {
      const next = new Set(s);
      visibleRuns.forEach((r) => (allVisibleSelected ? next.delete(r.run_number) : next.add(r.run_number)));
      return next;
    });
  }
  function toggleCol(c) {
    setOverrides((m) => new Map(m).set(c, !isOn(c)));
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await downloadQCReport([...selectedRuns], chosenCols);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const canDownload = selectedRuns.size > 0 && chosenCols.length > 0 && !busy;

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <header className="p-5 pb-4 flex flex-wrap items-center gap-3 border-b border-slate-200">
          <div className="flex-1 min-w-[14rem]">
            <h2 className="text-base font-bold">QC Report</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Select runs, choose which sample details to include, then download the PDF.
            </p>
          </div>
          <input
            className="field w-auto min-w-[12rem] py-1.5 text-sm"
            placeholder="Search runs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn-primary py-1.5 px-3 text-xs" disabled={!canDownload} onClick={download}>
            {busy ? <Spinner /> : <Icon name="download" size={13} />}
            Download PDF
          </button>
        </header>

        {error && (
          <div className="p-5 pb-0">
            <Alert kind="error">{error}</Alert>
          </div>
        )}

        {/* ---------- 1. runs ---------- */}
        {!runs && !error ? (
          <div className="p-8 flex justify-center text-brand-700">
            <Spinner />
          </div>
        ) : runs && visibleRuns.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {runs.length === 0 ? "No runs yet." : "No runs match your search."}
          </p>
        ) : (
          runs && (
            <div className="overflow-auto max-h-[22rem]">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
                    <th className="px-3 py-2.5 w-10">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-brand-700"
                        aria-label="Select all runs"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                      />
                    </th>
                    <th className="px-3 py-2.5 font-bold">Run</th>
                    <th className="px-3 py-2.5 font-bold">Status</th>
                    <th className="px-3 py-2.5 font-bold">Current stage</th>
                    <th className="px-3 py-2.5 font-bold text-right">Samples</th>
                    <th className="px-3 py-2.5 font-bold">Transferred</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRuns.map((r) => {
                    const on = selectedRuns.has(r.run_number);
                    return (
                      <tr
                        key={r.run_number}
                        onClick={() => toggleRun(r.run_number)}
                        className={`border-t border-slate-100 cursor-pointer ${on ? "bg-brand-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-brand-700"
                            aria-label={`Select ${r.run_number}`}
                            checked={on}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleRun(r.run_number)}
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            className="font-bold text-brand-700 hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewRun?.(r.run_number);
                            }}
                          >
                            {r.run_number}
                          </button>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.status}</td>
                        <td className="px-3 py-2">{r.current_stage}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.sample_count || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.transferred}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {runs && (
          <div className="px-5 py-2.5 border-t border-slate-200 text-xs text-slate-500 flex flex-wrap gap-x-4">
            <span>
              {selectedRuns.size} of {runs.length} run{runs.length === 1 ? "" : "s"} selected
              {selectedRuns.size > 0 && ` · ${totalSamples.toLocaleString()} sample${totalSamples === 1 ? "" : "s"}`}
            </span>
            {selectedRuns.size > 0 && (
              <button className="font-bold text-brand-700 hover:text-brand-900" onClick={() => setSelectedRuns(new Set())}>
                Clear selection
              </button>
            )}
          </div>
        )}

        {/* ---------- 2. sample columns ---------- */}
        {runs && (
          <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/60">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-bold text-slate-700">
                Sample details in the PDF
                {columns.length > 0 && (
                  <span className="font-semibold text-slate-500"> ({chosenCols.length} of {columns.length})</span>
                )}
              </h3>
              {columns.length > 0 && (
                <>
                  <button className="text-xs font-bold text-brand-700 hover:text-brand-900" onClick={() => setOverrides(new Map(columns.map((c) => [c, true])))}>
                    Select all
                  </button>
                  <button className="text-xs font-bold text-brand-700 hover:text-brand-900" onClick={() => setOverrides(new Map(columns.map((c) => [c, false])))}>
                    Clear
                  </button>
                </>
              )}
              {columns.length > 0 && chosenCols.length === 0 && (
                <span className="text-xs font-semibold text-accent-700">Choose at least one column.</span>
              )}
            </div>
            {columns.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                {selectedRuns.size === 0
                  ? "Select one or more runs above to see the sample columns available."
                  : "The selected runs have no consolidated Excel uploaded yet, so there's no sample data."}
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-2">
                {columns.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-brand-700"
                      checked={isOn(c)}
                      onChange={() => toggleCol(c)}
                    />
                    {label(c)}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
