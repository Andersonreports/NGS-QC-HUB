import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import PeriodFilter, { periodLabel } from "./PeriodFilter";
import { SampleModal } from "./SamplePreview";
import { Alert, Icon, Spinner } from "./ui";

// Rendering thousands of table rows at once makes the dialog sluggish; show the first
// batch and let search narrow the rest.
const ROW_LIMIT = 300;

const QC_CHIP = {
  Pass: "bg-emerald-50 text-emerald-700",
  Fail: "bg-rose-50 text-rose-700",
};

const nameKey = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const NO_METRICS = { fastp: {}, hs: {}, hs_metrics: [], available: false };
const NO_OP = () => {};

/** 2026-04-23 -> 23/04/2026; blank when the sample has no date. */
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
const NOT_SAVING = {};

/**
 * A dialog listing the samples behind one of the dashboard's headline numbers
 * (total, QC pass, QC fail, resequence). The backend returns the list using the same
 * rules as the count, so it always has as many rows as the card's number.
 *
 * `period` is the dashboard's month filter, applied by the server so the list matches the
 * card; the dialog's own Year / Month dropdowns narrow it further from the dates shown.
 *
 * Clicking a sample opens the same popup as the My Work preview — its sample
 * information, Fastp metrics and HS metrics — read-only here.
 */
export default function SampleListDialog({ category, period, title, tone, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [query, setQuery] = useState("");
  const [narrow, setNarrow] = useState({ year: "all", month: "all" }); // dialog's own filter
  const [loadingKey, setLoadingKey] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detail, setDetail] = useState(null);
  // Each run's sheet and metrics are fetched once and reused for its other samples.
  const sheets = useRef(new Map());
  const metricsByRun = useRef(new Map());

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: null, data: null });
    api
      .getTotalWorkDoneSamples(category, period)
      .then((data) => alive && setState({ loading: false, error: null, data }))
      .catch((e) => alive && setState({ loading: false, error: e.message, data: null }));
    return () => {
      alive = false;
    };
  }, [category, period]);

  // Esc closes the list — unless the sample popup is open, which handles its own Esc.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !detail && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, detail]);

  const samples = state.data?.samples ?? [];
  const showQc = category === "pass" || category === "fail";

  // The year / month choices are the dates present in this list.
  const periods = useMemo(() => {
    const counts = new Map();
    for (const s of samples) {
      const m = /^(\d{4})-(\d{2})/.exec(s.date || "");
      if (m) counts.set(`${m[1]}-${m[2]}`, (counts.get(`${m[1]}-${m[2]}`) || 0) + 1);
    }
    return [...counts].map(([k, count]) => ({ year: k.slice(0, 4), month: k.slice(5), count }));
  }, [samples]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return samples.filter((s) => {
      if (narrow.year !== "all" && !(s.date || "").startsWith(narrow.year)) return false;
      if (narrow.month !== "all" && (s.date || "").slice(5, 7) !== narrow.month) return false;
      return !q || [s.run, s.sample_id, s.sample_name, s.description, s.gen_id, s.test].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [samples, query, narrow]);

  const shown = filtered.slice(0, ROW_LIMIT);

  async function openSample(s, key) {
    setDetailError(null);
    setLoadingKey(key);
    try {
      if (!sheets.current.has(s.run)) sheets.current.set(s.run, api.getSheet(s.run));
      if (!metricsByRun.current.has(s.run)) {
        metricsByRun.current.set(s.run, api.getSampleMetrics(s.run).catch(() => NO_METRICS));
      }
      const [sheet, metrics] = await Promise.all([sheets.current.get(s.run), metricsByRun.current.get(s.run)]);

      // The run's own My Work row, so the popup shows every column and the QC status.
      const columns = sheet.columns || [];
      const idCol = columns.find((c) => nameKey(c) === "sampleid");
      const genCol = columns.find((c) => nameKey(c) === "genid");
      const same = (a, b) => a && b && String(a).trim() === String(b).trim();
      const row =
        (idCol && sheet.rows.find((r) => same(r.cells[idCol], s.sample_id))) ||
        (genCol && s.gen_id && sheet.rows.find((r) => same(r.cells[genCol], s.gen_id))) ||
        null;

      if (row) {
        const map = Object.fromEntries(columns.map((c) => [nameKey(c), c]));
        setDetail({ row, idCol: map.sampleid, colFor: (k) => map[k], metrics });
      } else {
        // The sheet has no matching row (e.g. it was loaded from another tab): show the
        // fields the list already has, with the Fastp / HS metrics still looked up by ID.
        const cells = { Sample_ID: s.sample_id, Sample_Name: s.sample_name, Description: s.description, Gen_ID: s.gen_id, Test: s.test };
        const map = Object.fromEntries(Object.keys(cells).map((c) => [nameKey(c), c]));
        setDetail({
          row: { row_index: -1, cells, qc_pass: s.qc || "—", resequencing: "—" },
          idCol: "Sample_ID",
          colFor: (k) => map[k],
          metrics,
        });
      }
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div
      className={`tone-${tone} fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 p-0 sm:p-6`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} samples`}
        className="bg-white w-full sm:max-w-5xl max-h-[90vh] sm:max-h-[85vh] min-h-[min(30rem,85vh)] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="flex items-start gap-3 px-5 py-4 border-b border-slate-200">
          <span className="w-1 self-stretch rounded-full" style={{ background: "var(--accent)" }} />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            <p className="text-sm text-slate-500">
              {state.data
                ? `${state.data.count.toLocaleString()} sample${state.data.count === 1 ? "" : "s"}${
                    periodLabel(period?.year, period?.month) ? ` in ${periodLabel(period.year, period.month)}` : ""
                  } · click a sample to see all its values`
                : "Loading samples…"}
            </p>
          </div>
          <button
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Icon name="search" size={15} className="absolute left-3 top-3 text-slate-400" />
            <input
              className="field pl-9"
              placeholder="Search sample, Anderson ID, Gen ID, test or run…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          {state.data && (query || narrow.year !== "all" || narrow.month !== "all") && (
            <span className="text-xs text-slate-500 shrink-0 ml-auto sm:ml-0">
              {filtered.length.toLocaleString()} match{filtered.length === 1 ? "" : "es"}
            </span>
          )}
          {periods.length > 0 && (
            <PeriodFilter className="ml-auto" periods={periods} year={narrow.year} month={narrow.month} onChange={setNarrow} />
          )}
        </div>

        {detailError && (
          <div className="px-5 pt-3">
            <Alert kind="error" onDismiss={() => setDetailError(null)}>
              Could not open that sample: {detailError}
            </Alert>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto">
          {state.loading ? (
            <div className="p-12 flex items-center justify-center gap-2.5 text-sm text-slate-500">
              <Spinner /> Loading samples…
            </div>
          ) : state.error ? (
            <div className="p-5">
              <Alert kind="error">Could not load the samples: {state.error}</Alert>
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-12 text-center text-sm text-slate-500">
              {samples.length === 0 ? "No samples to show." : "No samples match that search."}
            </p>
          ) : (
            <table className="w-full text-sm min-w-[62rem]">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-semibold w-12">#</th>
                  <th className="px-3 py-2.5 font-semibold">Sample ID</th>
                  <th className="px-3 py-2.5 font-semibold">Sample name</th>
                  <th className="px-3 py-2.5 font-semibold">Anderson ID</th>
                  <th className="px-3 py-2.5 font-semibold">Gen ID</th>
                  <th className="px-3 py-2.5 font-semibold">Test</th>
                  <th className="px-3 py-2.5 font-semibold">Date</th>
                  <th className="px-3 py-2.5 font-semibold">Run</th>
                  {showQc && <th className="px-3 py-2.5 font-semibold">QC</th>}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((s, i) => {
                  const key = `${s.run}-${s.sample_id}-${i}`;
                  // Rows that are not real samples (a sheet's metric rows) have nothing to open.
                  const openable = Boolean(s.sample_name || s.gen_id || s.test);
                  return (
                    <tr
                      key={key}
                      onClick={openable ? () => openSample(s, key) : undefined}
                      onKeyDown={openable ? (e) => e.key === "Enter" && openSample(s, key) : undefined}
                      tabIndex={openable ? 0 : undefined}
                      className={`focus:outline-none ${openable ? "cursor-pointer hover:bg-slate-50 focus:bg-slate-50" : ""}`}
                    >
                      <td className="px-5 py-2.5 text-slate-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">{s.sample_id || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-700">{s.sample_name || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{s.description || "-"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">{s.gen_id || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{s.test || "-"}</td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap tabular-nums">{formatDate(s.date) || "-"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">{s.run}</td>
                      {showQc && (
                        <td className="px-3 py-2.5">
                          {s.qc && <span className={`chip ${QC_CHIP[s.qc] || ""}`}>{s.qc}</span>}
                        </td>
                      )}
                      <td className="pr-4 text-slate-300">
                        {loadingKey === key ? <Spinner className="text-slate-400" /> : openable && <Icon name="chevronRight" size={15} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {filtered.length > ROW_LIMIT && (
          <footer className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
            Showing the first {ROW_LIMIT} of {filtered.length.toLocaleString()} — search to narrow the list.
          </footer>
        )}
      </div>

      {detail && (
        <SampleModal
          row={detail.row}
          colFor={detail.colFor}
          idCol={detail.idCol}
          metrics={detail.metrics}
          canEditQC={false}
          saving={NOT_SAVING}
          onChange={NO_OP}
          onClose={() => setDetail(null)}
          footerNote="QC status is changed from the run's My Work page."
        />
      )}
    </div>
  );
}
