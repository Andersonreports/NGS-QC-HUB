import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Alert, Icon, Spinner } from "./ui";

const QC_OPTIONS = ["Pass", "Fail"];
const RESEQ_OPTIONS = ["Yes", "No"];

// Sample-info columns shown in the table, matched against the workbook's headers
// ignoring case/spaces/underscores ("Gen_ID" = "Gen ID").
const INFO_COLUMNS = [
  { key: "sampleid", label: "Sample_ID", mono: true },
  { key: "samplename", label: "Sample_Name" },
  { key: "description", label: "Description" },
  { key: "genid", label: "Gen_ID" },
  { key: "test", label: "Test" },
  { key: "client", label: "Client" },
  { key: "gendertrf", label: "Gender_TRF" },
  { key: "genderigv", label: "Gender_IGV" },
  { key: "date", label: "Date", date: true },
];

const FASTP_FIELDS = [
  { key: "reads", label: "Number of Reads" },
  { key: "size", label: "Size of Reads" },
  { key: "q30", label: "Q30" },
  { key: "total", label: "Total Data Generated" },
];

// Presentation-only grouping of the HS metric names. The values always come from the
// workbook; a metric not matched by any group lands in "Other" instead of being dropped.
const HS_GROUPS = [
  { title: "Design & Territory", match: /^(GENOME_SIZE|BAIT_TERRITORY|TARGET_TERRITORY|BAIT_DESIGN_EFFICIENCY)$/ },
  { title: "Reads", match: /^(TOTAL_READS|PF_READS|PF_UNIQUE_READS|PCT_PF_READS|PCT_PF_UQ_READS|PF_UQ_READS_ALIGNED|PCT_PF_UQ_READS_ALIGNED)$/ },
  { title: "Bases", match: /^(PF_BASES_ALIGNED|PF_UQ_BASES_ALIGNED|ON_BAIT_BASES|NEAR_BAIT_BASES|OFF_BAIT_BASES|ON_TARGET_BASES)$/ },
  { title: "Selection & Enrichment", match: /^(PCT_SELECTED_BASES|PCT_OFF_BAIT|ON_BAIT_VS_SELECTED|PCT_USABLE_BASES_ON_BAIT|PCT_USABLE_BASES_ON_TARGET|FOLD_ENRICHMENT|FOLD_80_BASE_PENALTY)$/ },
  { title: "Coverage", match: /^(MEAN_BAIT_COVERAGE|MEAN_TARGET_COVERAGE|ZERO_CVG_TARGETS_PCT)$/ },
  { title: "Excluded Bases", match: /^PCT_EXC_/ },
  { title: "Target Bases at Depth", match: /^PCT_TARGET_BASES_/ },
  { title: "Library & Penalties", match: /^(HS_LIBRARY_SIZE|HS_PENALTY_)/ },
  { title: "Dropout & Yield", match: /^(AT_DROPOUT|GC_DROPOUT|TOTA)/i },
];

const nameKey = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function formatMetric(v) {
  if (isBlank(v)) return null;
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return Number(v.toPrecision(7)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  return String(v);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Accepts 2026-04-23 (what Excel dates arrive as) or 23/04/2026 (also - or . separated). */
function parseDate(v) {
  if (isBlank(v)) return null;
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: m[1], m: m[2].padStart(2, "0"), d: m[3].padStart(2, "0") };
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return { y: m[3], m: m[2].padStart(2, "0"), d: m[1].padStart(2, "0") };
  return null;
}

/** Shown as DD/MM/YYYY; anything unrecognised is shown as it appears in the file. */
function formatDate(v) {
  if (isBlank(v)) return null;
  const p = parseDate(v);
  return p ? `${p.d}/${p.m}/${p.y}` : String(v);
}

/** Pass = blue, Fail = orange (the app's brand/accent), Yes/No = neutral. */
const TONES = {
  Pass: "bg-brand-100 text-brand-800 border-brand-300",
  Fail: "bg-accent-100 text-accent-800 border-accent-300",
  Yes: "bg-slate-100 text-slate-700 border-slate-300",
  No: "bg-slate-100 text-slate-700 border-slate-300",
};

function StatusSelect({ value, options, editable, busy, onChange, label }) {
  const tone = TONES[value] || TONES.No;
  if (!editable) {
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold ${tone}`}>{value}</span>;
  }
  return (
    <span className="relative inline-flex items-center">
      <select
        aria-label={label}
        value={value}
        disabled={busy}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none cursor-pointer pl-3 pr-7 py-1 rounded-full border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60 disabled:cursor-wait ${tone}`}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-2 opacity-70" />
    </span>
  );
}

const TH =
  "sticky top-0 z-10 bg-slate-100 text-left text-[11px] uppercase tracking-wider font-bold text-slate-500 px-4 py-3 border-b border-slate-200 whitespace-nowrap";
const TD = "px-4 py-3.5 border-b border-slate-100";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Chip({ active, disabled, onClick, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
        active
          ? "bg-brand-700 border-brand-700 text-white"
          : disabled
            ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
            : "bg-white border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50"
      }`}
    >
      {children}
    </button>
  );
}

/** One small button that opens a popover with Year and Month chips, instead of two
 * always-visible dropdowns. The button itself shows the active filter, e.g. "Apr 2026". */
function FilterMenu({
  yearOptions, years, onToggleYear, onAllYears, monthOptions, months, onToggleMonth,
  qcs, onToggleQc, reseqs, onToggleReseq, onClear,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Button text: the picks themselves when there are one or two, otherwise a count.
  const nameOf = (v) => (v === "none" ? "No date" : v);
  const yearText = years.length === 0 ? "" : years.length <= 2 ? years.map(nameOf).join(", ") : `${years.length} years`;
  const monthText =
    months.length === 0 ? "" : months.length <= 2 ? months.map((m) => MONTH_ABBR[Number(m) - 1]).join(", ") : `${months.length} months`;
  const qcText = qcs.length === 0 ? "" : `QC ${qcs.join("/")}`;
  const reseqText = reseqs.length === 0 ? "" : `Re-seq ${reseqs.join("/")}`;
  const parts = [monthText, yearText, qcText, reseqText].filter(Boolean);
  // Keep the button short: spell the picks out for up to two groups, otherwise count the groups.
  const summary = parts.length <= 2 ? parts.join(" · ") : `${parts.length} filters`;
  const active = parts.length > 0;
  const monthCount = Object.fromEntries(monthOptions.map((o) => [o.value, o.count]));

  return (
    <div className="relative" ref={ref}>
      <div
        className={`inline-flex items-stretch rounded-xl border text-xs font-bold overflow-hidden ${
          active ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 hover:bg-black/5 transition-colors"
        >
          <Icon name="filter" size={13} />
          {summary || "Filter"}
        </button>
        {active && (
          <button type="button" onClick={onClear} title="Clear filter" aria-label="Clear filter" className="px-2 hover:bg-black/5 border-l border-brand-200">
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-3.5 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Year <span className="normal-case font-semibold tracking-normal">· pick one or more</span></div>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={years.length === 0} onClick={onAllYears}>
                All
              </Chip>
              {yearOptions.map((o) => (
                <Chip key={o.value} active={years.includes(o.value)} onClick={() => onToggleYear(o.value)}>
                  {o.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Month <span className="normal-case font-semibold tracking-normal">· pick one or more</span></div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTH_ABBR.map((name, idx) => {
                const value = String(idx + 1).padStart(2, "0");
                const count = monthCount[value] || 0;
                return (
                  <Chip
                    key={value}
                    active={months.includes(value)}
                    disabled={count === 0}
                    onClick={() => onToggleMonth(value)}
                  >
                    {name}
                  </Chip>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">QC Pass</div>
            <div className="flex flex-wrap gap-1.5">
              {QC_OPTIONS.map((v) => (
                <Chip key={v} active={qcs.includes(v)} onClick={() => onToggleQc(v)}>
                  {v}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Re-Sequencing</div>
            <div className="flex flex-wrap gap-1.5">
              {RESEQ_OPTIONS.map((v) => (
                <Chip key={v} active={reseqs.includes(v)} onClick={() => onToggleReseq(v)}>
                  {v}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              disabled={!active}
              className="text-xs font-bold text-slate-500 hover:text-accent-700 disabled:opacity-40 disabled:hover:text-slate-500"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-bold bg-brand-700 hover:bg-brand-800 text-white rounded-lg px-4 py-1.5 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Preview tab for the consolidated Excel: the sample_info table, plus a per-sample popup
 * with Fastp and HS metrics. One `sheet` state feeds both the table and the popup, so a
 * QC Pass / Re-Sequencing change in either place shows in the other immediately and is
 * saved through the existing /sheet/qc endpoint (Primary Team Head only, as before).
 */
export default function SamplePreview({ runNumber, role }) {
  const [sheet, setSheet] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState({}); // `${row_index}:${field}` -> true
  const [openRow, setOpenRow] = useState(null);
  const [expanded, setExpanded] = useState(false); // fill the screen instead of the narrow pane

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => e.key === "Escape" && openRow === null && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, openRow]);
  const [years, setYears] = useState([]); // selected "YYYY" / "none" (no date); empty = every year
  const [months, setMonths] = useState([]); // selected "01".."12"; empty = every month
  const [qcs, setQcs] = useState([]); // selected "Pass" / "Fail"; empty = either
  const [reseqs, setReseqs] = useState([]); // selected "Yes" / "No"; empty = either

  useEffect(() => {
    let alive = true;
    setYears([]);
    setMonths([]);
    setQcs([]);
    setReseqs([]);
    setSheet(null);
    setMetrics(null);
    setError(null);
    setOpenRow(null);
    api.getSheet(runNumber).then((d) => alive && setSheet(d)).catch((e) => alive && setError(e.message));
    api
      .getSampleMetrics(runNumber)
      .then((d) => alive && setMetrics(d))
      .catch(() => alive && setMetrics({ fastp: {}, hs: {}, hs_metrics: [], available: false }));
    return () => {
      alive = false;
    };
  }, [runNumber]);

  const colFor = useMemo(() => {
    const map = {};
    for (const c of sheet?.columns || []) map[nameKey(c)] = c;
    return (key) => map[key];
  }, [sheet?.columns]);

  const canEditQC = !!sheet?.can_edit_qc;

  // The table needs the workbook's sample_info tab. If the shared sheet was last loaded
  // from another tab (e.g. HS-metrics), switch back to it (any role may do this).
  const sampleTab = sheet?.available_sheet_names?.find((n) => nameKey(n) === "sampleinfo");
  const needsSampleTab = !!sheet && !sheet.columns.some((c) => nameKey(c) === "sampleid") && !!sampleTab;
  const [switching, setSwitching] = useState(false);
  const [switchTried, setSwitchTried] = useState(false);
  useEffect(() => {
    if (!needsSampleTab || switchTried) return;
    setSwitchTried(true);
    setSwitching(true);
    api
      .useSampleTab(runNumber)
      .then(setSheet)
      .catch((e) => setError(e.message))
      .finally(() => setSwitching(false));
  }, [needsSampleTab, switchTried, runNumber]);

  const updateQC = useCallback(
    async (rowIndex, field, value) => {
      const tag = `${rowIndex}:${field}`;
      const previous = sheet.rows.find((r) => r.row_index === rowIndex)?.[field];
      setSaveError(null);
      setSaving((s) => ({ ...s, [tag]: true }));
      // Optimistic: the table and popup both read from `sheet`, so both update at once.
      setSheet((s) => ({ ...s, rows: s.rows.map((r) => (r.row_index === rowIndex ? { ...r, [field]: value } : r)) }));
      try {
        const updated = await api.editSheetQC(runNumber, { row_index: rowIndex, [field]: value });
        setSheet(updated);
      } catch (e) {
        setSheet((s) => ({ ...s, rows: s.rows.map((r) => (r.row_index === rowIndex ? { ...r, [field]: previous } : r)) }));
        setSaveError(e.message);
      } finally {
        setSaving((s) => {
          const next = { ...s };
          delete next[tag];
          return next;
        });
      }
    },
    [sheet, runNumber]
  );

  // Year + Month filters, from the sample sheet's Date column. Years offered are the ones
  // present; months offered are the ones present within the chosen year.
  const dateCol = colFor("date");
  const partsOf = useCallback(
    (row) => {
      const p = dateCol ? parseDate(row.cells[dateCol]) : null;
      return p ? { y: p.y, m: p.m } : { y: "none", m: "none" };
    },
    [dateCol]
  );
  const yearOptions = useMemo(() => {
    const counts = {};
    for (const r of sheet?.rows || []) {
      const y = partsOf(r).y;
      counts[y] = (counts[y] || 0) + 1;
    }
    return Object.keys(counts)
      .sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : b.localeCompare(a)))
      .map((y) => ({ value: y, label: y === "none" ? "No date" : y, count: counts[y] }));
  }, [sheet?.rows, partsOf]);
  const activeYears = years.filter((y) => yearOptions.some((o) => o.value === y));
  const inYear = useMemo(
    () => (activeYears.length === 0 ? sheet?.rows || [] : (sheet?.rows || []).filter((r) => activeYears.includes(partsOf(r).y))),
    [sheet?.rows, activeYears, partsOf]
  );
  const monthOptions = useMemo(() => {
    const counts = {};
    for (const r of inYear) {
      const m = partsOf(r).m;
      if (m !== "none") counts[m] = (counts[m] || 0) + 1;
    }
    return Object.keys(counts)
      .sort()
      .map((m) => ({ value: m, label: MONTH_NAMES[Number(m) - 1] || m, count: counts[m] }));
  }, [inYear, partsOf]);
  const activeMonths = months.filter((m) => monthOptions.some((o) => o.value === m));
  const visibleRows = useMemo(
    () =>
      inYear.filter(
        (r) =>
          (activeMonths.length === 0 || activeMonths.includes(partsOf(r).m)) &&
          (qcs.length === 0 || qcs.includes(r.qc_pass)) &&
          (reseqs.length === 0 || reseqs.includes(r.resequencing))
      ),
    [inYear, activeMonths, qcs, reseqs, partsOf]
  );
  const filtered = activeYears.length > 0 || activeMonths.length > 0 || qcs.length > 0 || reseqs.length > 0;

  if (error) {
    return (
      <div className="h-full overflow-auto p-4">
        <Alert kind="error">{error}</Alert>
      </div>
    );
  }
  if (!sheet || switching) {
    return (
      <div className="h-full flex items-center justify-center text-brand-700 py-16">
        <Spinner />
      </div>
    );
  }

  const idCol = colFor("sampleid");
  const hasSampleColumns = !!idCol;
  const selected = openRow === null ? null : sheet.rows.find((r) => r.row_index === openRow);

  const stats = {
    total: visibleRows.length,
    pass: visibleRows.filter((r) => r.qc_pass === "Pass").length,
    fail: visibleRows.filter((r) => r.qc_pass === "Fail").length,
    reseq: visibleRows.filter((r) => r.resequencing === "Yes").length,
  };
  // Exports exactly what the table is showing (so the year/month filter applies), with the
  // same columns, DD/MM/YYYY dates, and the current QC Pass / Re-Sequencing values.
  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const header = [...INFO_COLUMNS.map((c) => c.label), "QC Pass", "Re-Sequencing"];
      const body = visibleRows.map((row) => [
        ...INFO_COLUMNS.map((c) => {
          const col = colFor(c.key);
          const raw = col ? row.cells[col] : null;
          return (c.date ? formatDate(raw) : isBlank(raw) ? null : String(raw)) ?? "";
        }),
        row.qc_pass,
        row.resequencing,
      ]);
      const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
      ws["!cols"] = header.map((h, i) => ({
        wch: Math.min(40, Math.max(h.length, ...body.map((r) => String(r[i] ?? "").length)) + 2),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Samples");
      const tag = [
        activeYears.map((y) => (y === "none" ? "NoDate" : y)).join("-"),
        activeMonths.map((m) => MONTH_ABBR[Number(m) - 1]).join("-"),
        qcs.length ? `QC-${qcs.join("-")}` : "",
        reseqs.length ? `Reseq-${reseqs.join("-")}` : "",
      ]
        .filter(Boolean)
        .join("_");
      XLSX.writeFile(wb, `${runNumber}_Samples${tag ? `_${tag}` : ""}.xlsx`);
    } catch (e) {
      setSaveError(`Could not export: ${e.message}`);
    }
  };
  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const resetFilters = () => {
    setYears([]);
    setMonths([]);
    setQcs([]);
    setReseqs([]);
  };

  return (
    <div className={expanded ? "fixed inset-0 z-40 flex flex-col min-h-0 bg-slate-50" : "h-full flex flex-col min-h-0 bg-slate-50"}>
      {/* One slim toolbar: title and counts on the left, filters and expand on the right */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-slate-800 leading-tight">Sample information</div>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-x-3 flex-wrap">
              <span>{filtered ? `${stats.total} of ${sheet.rows.length}` : stats.total} samples</span>
              {hasSampleColumns && (
                <>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-brand-500" />
                    {stats.pass} Pass
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-accent-500" />
                    {stats.fail} Fail
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    {stats.reseq} Re-seq
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {hasSampleColumns && (
              <FilterMenu
                yearOptions={yearOptions}
                years={activeYears}
                onToggleYear={(v) => toggle(years, setYears, v)}
                onAllYears={() => setYears([])}
                monthOptions={monthOptions}
                months={activeMonths}
                onToggleMonth={(v) => toggle(months, setMonths, v)}
                qcs={qcs}
                onToggleQc={(v) => toggle(qcs, setQcs, v)}
                reseqs={reseqs}
                onToggleReseq={(v) => toggle(reseqs, setReseqs, v)}
                onClear={resetFilters}
              />
            )}
            <button
              onClick={exportExcel}
              disabled={!hasSampleColumns || visibleRows.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl px-3 py-1.5 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              title={filtered ? "Export the filtered samples to Excel" : "Export all samples to Excel"}
            >
              <Icon name="download" size={13} />
              Export
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl px-3 py-1.5 transition-colors"
              title={expanded ? "Back to the page (Esc)" : "Open full screen for more room"}
            >
              <Icon name={expanded ? "x" : "panelLeft"} size={13} />
              {expanded ? "Close" : "Full screen"}
            </button>
          </div>
        </div>
        {!canEditQC && (
          <div className="text-[11px] text-slate-400 mt-2">QC Pass / Re-Sequencing are set by the Primary Team Head.</div>
        )}
      </div>

      {saveError && (
        <div className="px-5 pt-3 shrink-0">
          <Alert kind="error" onDismiss={() => setSaveError(null)}>
            {saveError}
          </Alert>
        </div>
      )}

      {!hasSampleColumns ? (
        <div className="p-5">
          <Alert kind="info">
            The sheet is loaded from the “{sheet.source_sheet_name || "unknown"}” tab, which has no Sample_ID column, and this
            workbook has no Sample-Info tab to switch to, so there is no sample table to show.
          </Alert>
        </div>
      ) : (
        <div className="flex-1 min-h-0 p-3">
          <div className="h-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[68rem] text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  {INFO_COLUMNS.map((c) => (
                    <th key={c.key} className={`${TH} ${c.mono ? "!left-0 !z-20 border-r" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                  <th className={`${TH} !bg-brand-50 !text-brand-800`}>QC Pass</th>
                  <th className={TH}>Re-Sequencing</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => (
                  <tr
                    key={row.row_index}
                    onClick={() => setOpenRow(row.row_index)}
                    className={`group cursor-pointer transition-colors hover:bg-brand-50 ${
                      row.qc_pass === "Fail" ? "bg-accent-50/60" : i % 2 ? "bg-slate-50/60" : "bg-white"
                    }`}
                  >
                    {INFO_COLUMNS.map((c) => {
                      const col = colFor(c.key);
                      const raw = col ? row.cells[col] : null;
                      const val = c.date ? formatDate(raw) : isBlank(raw) ? null : String(raw);
                      let cls = "text-slate-600";
                      if (c.key === "samplename") cls = "text-slate-900 font-semibold";
                      return (
                        <td key={c.key} className={`${TD} max-w-[15rem] truncate ${c.mono ? "sticky left-0 z-10 bg-inherit border-r border-r-slate-200" : cls}`} title={val || ""}>
                          {val === null ? (
                            <span className="text-slate-300">—</span>
                          ) : c.mono ? (
                            <span className="inline-block font-mono text-xs font-semibold text-brand-800 bg-brand-50 border border-brand-100 rounded-md px-2 py-0.5">
                              {val}
                            </span>
                          ) : (
                            val
                          )}
                        </td>
                      );
                    })}
                    <td className={`${TD} whitespace-nowrap`}>
                      <StatusSelect
                        label="QC Pass"
                        value={row.qc_pass}
                        options={QC_OPTIONS}
                        editable={canEditQC}
                        busy={!!saving[`${row.row_index}:qc_pass`]}
                        onChange={(v) => updateQC(row.row_index, "qc_pass", v)}
                      />
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <StatusSelect
                        label="Re-Sequencing"
                        value={row.resequencing}
                        options={RESEQ_OPTIONS}
                        editable={canEditQC}
                        busy={!!saving[`${row.row_index}:resequencing`]}
                        onChange={(v) => updateQC(row.row_index, "resequencing", v)}
                      />
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={INFO_COLUMNS.length + 2} className="px-3 py-14 text-center">
                      <div className="text-sm font-semibold text-slate-500">
                        {sheet.rows.length === 0 ? "No samples found in this workbook." : "No samples match the selected filters."}
                      </div>
                      {filtered && (
                        <button onClick={resetFilters} className="mt-2 text-xs font-bold text-brand-700 hover:text-brand-900">
                          Clear filters
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <SampleModal
          row={selected}
          colFor={colFor}
          idCol={idCol}
          metrics={metrics}
          canEditQC={canEditQC}
          saving={saving}
          onChange={updateQC}
          onClose={() => setOpenRow(null)}
        />
      )}
    </div>
  );
}

function Section({ icon, title, children, tone = "brand" }) {
  const head = tone === "accent" ? "text-accent-800" : "text-brand-800";
  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <h3 className={`px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-extrabold uppercase tracking-wide flex items-center gap-2 ${head}`}>
        <Icon name={icon} size={14} />
        {title}
      </h3>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">{label}</div>
      <div className={`text-sm mt-0.5 break-words ${mono ? "font-mono text-xs" : ""} ${value ? "text-slate-800" : "text-slate-300"}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function MetricTile({ label, value, wide }) {
  return (
    <div className={`rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 min-w-0 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400 break-words">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 break-words tabular-nums ${value ? "text-slate-800" : "text-slate-300"}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}

export function SampleModal({ row, colFor, idCol, metrics, canEditQC, saving, onChange, onClose, footerNote }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const sampleId = String(row.cells[idCol] ?? "").trim();
  const fastp = metrics?.fastp?.[sampleId];
  const hs = metrics?.hs?.[sampleId];
  const hsOrder = metrics?.hs_metrics || [];

  const grouped = useMemo(() => {
    const groups = HS_GROUPS.map((g) => ({ title: g.title, names: [] }));
    const other = { title: "Other", names: [] };
    for (const name of hsOrder) {
      const g = HS_GROUPS.findIndex((x) => x.match.test(name));
      (g === -1 ? other : groups[g]).names.push(name);
    }
    return [...groups, other].filter((g) => g.names.length);
  }, [hsOrder]);

  const info = (key, opts = {}) => {
    const col = colFor(key);
    const raw = col ? row.cells[col] : null;
    if (isBlank(raw)) return null;
    return opts.date ? formatDate(raw) : String(raw);
  };

  const qcControls = (
    <div className="flex items-center gap-6 flex-wrap">
      <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
        QC Pass
        <StatusSelect
          label="QC Pass"
          value={row.qc_pass}
          options={QC_OPTIONS}
          editable={canEditQC}
          busy={!!saving[`${row.row_index}:qc_pass`]}
          onChange={(v) => onChange(row.row_index, "qc_pass", v)}
        />
      </label>
      <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
        Re-Sequencing
        <StatusSelect
          label="Re-Sequencing"
          value={row.resequencing}
          options={RESEQ_OPTIONS}
          editable={canEditQC}
          busy={!!saving[`${row.row_index}:resequencing`]}
          onChange={(v) => onChange(row.row_index, "resequencing", v)}
        />
      </label>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/50 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Sample ${sampleId}`}
    >
      <div
        className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 bg-gradient-to-r from-brand-800 to-brand-600 text-white flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
            <Icon name="dna" size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate">{info("samplename") || sampleId || "Sample"}</div>
            <div className="text-xs text-brand-100 font-mono truncate">{sampleId}</div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white shrink-0" title="Close" aria-label="Close">
            <Icon name="x" size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <Section icon="clipboard" title="Sample Information">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-5 gap-y-3">
              {INFO_COLUMNS.map((c) => (
                <Field key={c.key} label={c.label} value={info(c.key, c)} mono={c.mono} />
              ))}
              <div>
                <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">QC Pass</div>
                <div className="mt-1">
                  <StatusSelect label="QC Pass" value={row.qc_pass} options={QC_OPTIONS} editable={false} />
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">Re-Sequencing</div>
                <div className="mt-1">
                  <StatusSelect label="Re-Sequencing" value={row.resequencing} options={RESEQ_OPTIONS} editable={false} />
                </div>
              </div>
            </div>
          </Section>

          <Section icon="activity" title="Fastp Metrics">
            {!metrics ? (
              <div className="flex justify-center py-4 text-brand-700">
                <Spinner />
              </div>
            ) : !fastp ? (
              <p className="text-sm text-slate-400">No Fastp metrics found for this Sample_ID in the workbook.</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  ["Before Fastp", "before"],
                  ["After Fastp", "after"],
                ].map(([title, part]) => (
                  <div key={part} className="rounded-lg border border-slate-200 p-3">
                    <div className={`text-[11px] font-extrabold uppercase tracking-wide mb-2 ${part === "after" ? "text-brand-700" : "text-accent-700"}`}>
                      {title}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {FASTP_FIELDS.map((f) => (
                        <MetricTile key={f.key} label={f.label} value={formatMetric(fastp[part]?.[f.key])} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon="layers" title="HS Metrics">
            {!metrics ? (
              <div className="flex justify-center py-4 text-brand-700">
                <Spinner />
              </div>
            ) : !hs ? (
              <p className="text-sm text-slate-400">No HS metrics found for this Sample_ID in the workbook.</p>
            ) : (
              <div className="space-y-4">
                {grouped.map((g) => (
                  <div key={g.title}>
                    <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500 mb-2">{g.title}</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {g.names.map((name) => (
                        <MetricTile key={name} label={name} value={formatMetric(hs[name])} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <footer className="px-5 py-3 bg-white border-t border-slate-200 flex items-center gap-4 flex-wrap shrink-0">
          {qcControls}
          {!canEditQC && <span className="text-[11px] text-slate-400">{footerNote ?? "Only the Primary Team Head can change these."}</span>}
          <button className="btn-ghost ml-auto py-1.5 px-3 text-xs" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
