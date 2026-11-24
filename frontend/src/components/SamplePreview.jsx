import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, downloadSampleReport } from "../api";
import { Alert, Icon, Spinner } from "./ui";

const QC_OPTIONS = ["Pass", "Fail"];
const RESEQ_OPTIONS = ["Yes", "No"];

// Sample-info columns shown in the table, matched against the workbook's headers
// ignoring case/spaces/underscores ("Gen_ID" = "Gen ID").
const INFO_COLUMNS = [
  { key: "sampleid", label: "Sample_ID", mono: true },
  { key: "samplename", label: "Sample_Name" },
  { key: "description", label: "Anderson ID" },
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

// The handful of numbers a reviewer looks at first, shown large above the full list.
const HS_HIGHLIGHTS = [
  { match: /^MEAN_TARGET_COVERAGE$/i, label: "Mean target coverage" },
  { match: /^PCT_TARGET_BASES_20X$/i, label: "Target bases ≥ 20X" },
  { match: /^FOLD_ENRICHMENT$/i, label: "Fold enrichment" },
  { match: /^TOTA/i, label: "Total data generated" },
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
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

// ---- small visual helpers -----------------------------------------------------------

function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// Tests are coloured by family, so "WES" and "WES+Mito" share a colour while WES, CES, a
// hereditary-cancer panel and so on each get their own. The first matching rule wins; a test
// that matches none is grouped by its first word and takes one of the spare colours.
const TEST_FAMILIES = [
  { id: "wes", match: /^WES/i },
  { id: "wgs", match: /\bWGS\b/i },
  { id: "ces", match: /\bCES\b/i },
  { id: "point", match: /POINT\s*MUTATION/i },
  { id: "genesight", match: /GENESIGHT/i },
  { id: "cancer", match: /CANCER/i },
  { id: "fh", match: /HYPERCHOLESTEROLEMIA/i },
  { id: "mito", match: /MITO/i },
  { id: "panel", match: /PANEL/i },
];

// Class names are written out in full so Tailwind can see them.
const FAMILY_TONES = {
  wes: "bg-brand-50 text-brand-800 border-brand-200",
  wgs: "bg-violet-50 text-violet-700 border-violet-200",
  ces: "bg-teal-50 text-teal-700 border-teal-200",
  point: "bg-rose-50 text-rose-700 border-rose-200",
  genesight: "bg-indigo-50 text-indigo-700 border-indigo-200",
  cancer: "bg-pink-50 text-pink-700 border-pink-200",
  fh: "bg-orange-50 text-orange-700 border-orange-200",
  mito: "bg-amber-50 text-amber-800 border-amber-200",
  panel: "bg-cyan-50 text-cyan-700 border-cyan-200",
};
const SPARE_TONES = [
  "bg-lime-50 text-lime-800 border-lime-200",
  "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  "bg-sky-50 text-sky-700 border-sky-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-slate-100 text-slate-600 border-slate-300",
];

function testTone(name) {
  const text = String(name).trim();
  const family = TEST_FAMILIES.find((f) => f.match.test(text));
  if (family) return FAMILY_TONES[family.id];
  const firstWord = text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)[0] || text;
  return SPARE_TONES[hashOf(firstWord) % SPARE_TONES.length];
}

function Tag({ children, tone }) {
  return (
    <span
      className={`inline-block max-w-full truncate align-middle text-[11px] font-bold px-2 py-0.5 rounded-md border ${tone}`}
      title={typeof children === "string" ? children : undefined}
    >
      {children}
    </span>
  );
}

function TestTag({ value }) {
  return <Tag tone={testTone(value)}>{value}</Tag>;
}

function GenderChip({ value }) {
  const v = String(value);
  const male = /^m/i.test(v);
  const female = /^f/i.test(v);
  const tone = male ? "bg-sky-50 text-sky-700 border-sky-200" : female ? "bg-pink-50 text-pink-700 border-pink-200" : "bg-slate-50 text-slate-600 border-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border ${tone}`}>
      {male ? "♂" : female ? "♀" : ""} {v}
    </span>
  );
}

/** Renders one sample-info cell the way it should look, wherever it appears. */
function CellValue({ col, val }) {
  if (val === null) return <span className="text-slate-300">—</span>;
  switch (col.key) {
    case "sampleid":
      return (
        <span className="inline-block font-mono text-xs font-bold text-brand-800 bg-brand-50 border border-brand-100 rounded-md px-2 py-0.5">
          {val}
        </span>
      );
    case "description":
      return <span className="font-mono text-xs text-slate-600">{val}</span>;
    case "genid":
      return <span className="font-mono text-xs text-slate-500">{val}</span>;
    case "test":
      return <TestTag value={val} />;
    case "gendertrf":
    case "genderigv":
      return <GenderChip value={val} />;
    case "date":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 tabular-nums">
          <Icon name="calendar" size={12} className="text-slate-300" />
          {val}
        </span>
      );
    default:
      return val;
  }
}

/** Pass = blue, Fail = orange (the app's brand/accent), Yes/No = neutral. */
const STATUS = {
  Pass: { tone: "bg-brand-50 text-brand-800 border-brand-300", icon: "circleCheck" },
  Fail: { tone: "bg-accent-50 text-accent-800 border-accent-300", icon: "circleX" },
  Yes: { tone: "bg-slate-100 text-slate-700 border-slate-300", icon: "repeat" },
  No: { tone: "bg-slate-50 text-slate-500 border-slate-200", icon: "minusCircle" },
};

function StatusSelect({ value, options, editable, busy, onChange, label }) {
  const s = STATUS[value] || STATUS.No;
  if (!editable) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${s.tone}`}>
        <Icon name={s.icon} size={13} />
        {value}
      </span>
    );
  }
  return (
    <span className={`relative inline-flex items-center rounded-full border transition-shadow focus-within:ring-2 focus-within:ring-brand-200 ${s.tone} ${busy ? "opacity-60" : ""}`}>
      <Icon name={s.icon} size={13} className="pointer-events-none absolute left-2.5" />
      <select
        aria-label={label}
        value={value}
        disabled={busy}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent cursor-pointer pl-8 pr-7 py-1 text-xs font-bold focus:outline-none disabled:cursor-wait"
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
  "sticky top-0 z-10 bg-slate-100/95 backdrop-blur text-left text-[11px] uppercase tracking-wider font-bold text-slate-500 px-4 py-3 border-b border-slate-200 whitespace-nowrap";
const TD = "px-4 py-3 border-b border-slate-100";

function Chip({ active, disabled, onClick, block, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={!!active}
      className={`${block ? "w-full" : ""} px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
        active
          ? "bg-brand-700 border-brand-700 text-white shadow-sm"
          : disabled
            ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
            : "bg-white border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50"
      }`}
    >
      {children}
    </button>
  );
}

function FilterGroup({ title, children }) {
  return (
    <div>
      <div className="text-xs font-extrabold text-slate-700 mb-2.5">{title}</div>
      {children}
    </div>
  );
}

/** One small button that opens a popover with Year, Month, Test, QC Pass and Re-Sequencing chips
 * (each multi-select). The button itself shows the active filter, e.g. "Apr 2026". */
function FilterMenu({
  yearOptions, years, onToggleYear, onAllYears, monthOptions, months, onToggleMonth,
  testOptions, tests, onToggleTest, qcs, onToggleQc, reseqs, onToggleReseq, onClear,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  // The panel lives in a portal on <body>, positioned from the button's rectangle, because the
  // preview sits inside cards with overflow hidden that would otherwise cut it off.
  const [rect, setRect] = useState(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      setWide(window.innerWidth >= 640);
      setRect(ref.current ? ref.current.getBoundingClientRect() : null);
    };
    place();
    const onDown = (e) => {
      const t = e.target;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Button text: the picks themselves when there are one or two, otherwise a count.
  const nameOf = (v) => (v === "none" ? "No date" : v);
  const yearText = years.length === 0 ? "" : years.length <= 2 ? years.map(nameOf).join(", ") : `${years.length} years`;
  const monthText =
    months.length === 0 ? "" : months.length <= 2 ? months.map((m) => MONTH_ABBR[Number(m) - 1]).join(", ") : `${months.length} months`;
  const testText = tests.length === 0 ? "" : tests.length === 1 ? tests[0] : `${tests.length} tests`;
  const qcText = qcs.length === 0 ? "" : `QC ${qcs.join("/")}`;
  const reseqText = reseqs.length === 0 ? "" : `Re-seq ${reseqs.join("/")}`;
  const parts = [monthText, yearText, testText, qcText, reseqText].filter(Boolean);
  // Keep the button short: spell the picks out for up to two groups, otherwise count the groups.
  const summary = parts.length <= 2 ? parts.join(" · ") : `${parts.length} filters`;
  const active = parts.length > 0;
  const monthCount = Object.fromEntries(monthOptions.map((o) => [o.value, o.count]));

  return (
    <div className="relative" ref={ref}>
      <div
        className={`inline-flex items-stretch rounded-xl border text-xs font-bold overflow-hidden shadow-sm ${
          active ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 px-3 py-2 hover:bg-black/5 transition-colors"
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

      {open &&
        createPortal(
          <>
            {!wide && <div className="fixed inset-0 z-[59] bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden="true" />}
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Filters"
              style={
                wide && rect
                  ? { top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right), maxHeight: `calc(100vh - ${rect.bottom + 20}px)` }
                  : undefined
              }
              className={`fade-up fixed z-[60] flex flex-col border border-slate-200 bg-white shadow-2xl overflow-hidden ${
                wide ? "w-[23rem] max-w-[calc(100vw-1.5rem)] rounded-2xl" : "inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl"
              }`}
            >
          <div className="flex items-center px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
            <h3 className="text-sm font-extrabold text-slate-800">Filters</h3>
            <button
              type="button"
              onClick={onClear}
              disabled={!active}
              className="ml-auto text-xs font-bold text-slate-500 hover:text-accent-700 disabled:opacity-40 disabled:hover:text-slate-500"
            >
              Clear all
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            <FilterGroup title="Year">
              <div className="flex flex-wrap gap-2">
                <Chip active={years.length === 0} onClick={onAllYears}>
                  All
                </Chip>
                {yearOptions.map((o) => (
                  <Chip key={o.value} active={years.includes(o.value)} onClick={() => onToggleYear(o.value)}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            </FilterGroup>

            <FilterGroup title="Month">
              <div className="grid grid-cols-4 gap-2">
                {MONTH_ABBR.map((name, idx) => {
                  const value = String(idx + 1).padStart(2, "0");
                  return (
                    <Chip key={value} active={months.includes(value)} disabled={!monthCount[value]} onClick={() => onToggleMonth(value)} block>
                      {name}
                    </Chip>
                  );
                })}
              </div>
            </FilterGroup>

            {testOptions.length > 0 && (
              <FilterGroup title="Test">
                <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
                  {testOptions.map((o) => {
                    const on = tests.includes(o.value);
                    return (
                      <li key={o.value}>
                        <label className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer text-sm transition-colors ${on ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => onToggleTest(o.value)}
                            className="w-4 h-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
                          />
                          <span className={`flex-1 min-w-0 truncate ${on ? "font-bold text-brand-800" : "text-slate-700"}`} title={o.label}>
                            {o.label}
                          </span>
                          <span className="text-xs text-slate-400 tabular-nums">{o.count}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </FilterGroup>
            )}

            <FilterGroup title="QC Pass">
              <div className="grid grid-cols-2 gap-2">
                {QC_OPTIONS.map((v) => (
                  <Chip key={v} active={qcs.includes(v)} onClick={() => onToggleQc(v)} block>
                    {v}
                  </Chip>
                ))}
              </div>
            </FilterGroup>

            <FilterGroup title="Re-Sequencing">
              <div className="grid grid-cols-2 gap-2">
                {RESEQ_OPTIONS.map((v) => (
                  <Chip key={v} active={reseqs.includes(v)} onClick={() => onToggleReseq(v)} block>
                    {v}
                  </Chip>
                ))}
              </div>
            </FilterGroup>
          </div>

          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/70 shrink-0">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full text-sm font-bold bg-brand-700 hover:bg-brand-800 text-white rounded-xl py-2.5 transition-colors"
            >
              Done
            </button>
          </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

/** A clickable count in the summary strip; clicking it applies that filter. */
function SummaryPill({ tone, label, value, active, onClick, title }) {
  const tones = {
    slate: { dot: "bg-slate-400", on: "bg-slate-800 text-white border-slate-800" },
    blue: { dot: "bg-brand-500", on: "bg-brand-700 text-white border-brand-700" },
    orange: { dot: "bg-accent-500", on: "bg-accent-600 text-white border-accent-600" },
    violet: { dot: "bg-violet-500", on: "bg-violet-600 text-white border-violet-600" },
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={!!active}
      className={`inline-flex items-center gap-2 shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active ? tones.on : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${active ? "bg-white" : tones.dot}`} />
      <span className="font-extrabold tabular-nums">{value}</span>
      {label}
    </button>
  );
}

const BTN =
  "inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl px-3 py-2 shadow-sm transition-colors";

/**
 * Preview tab for the consolidated Excel: the sample_info table, plus a per-sample popup
 * with Fastp and HS metrics. One `sheet` state feeds both the table and the popup, so a
 * QC Pass / Re-Sequencing change in either place shows in the other immediately and is
 * saved through the existing /sheet/qc endpoint (Primary Team Head only, as before).
 */
export default function SamplePreview({ runNumber, role, onDownload }) {
  const [sheet, setSheet] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState({}); // `${row_index}:${field}` -> true
  const [openRow, setOpenRow] = useState(null);
  const [expanded, setExpanded] = useState(false); // fill the screen instead of the narrow pane
  const [query, setQuery] = useState("");
  // Table vs. cards depends on how wide this pane is, not the window: beside the side panel
  // on a laptop the pane is narrow even though the screen is wide.
  const [rootEl, setRootEl] = useState(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!rootEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 880));
    ro.observe(rootEl);
    return () => ro.disconnect();
  }, [rootEl]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => e.key === "Escape" && openRow === null && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, openRow]);
  const [years, setYears] = useState([]); // selected "YYYY" / "none" (no date); empty = every year
  const [months, setMonths] = useState([]); // selected "01".."12"; empty = every month
  const [tests, setTests] = useState([]); // selected Test values; empty = every test
  const [qcs, setQcs] = useState([]); // selected "Pass" / "Fail"; empty = either
  const [reseqs, setReseqs] = useState([]); // selected "Yes" / "No"; empty = either

  useEffect(() => {
    let alive = true;
    setYears([]);
    setMonths([]);
    setTests([]);
    setQcs([]);
    setReseqs([]);
    setQuery("");
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
  // present; months offered are the ones present within the chosen years.
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
  // Test filter: one option per distinct value in the Test column, most common first.
  const testCol = colFor("test");
  const testOf = useCallback((row) => (testCol && !isBlank(row.cells[testCol]) ? String(row.cells[testCol]).trim() : ""), [testCol]);
  const testOptions = useMemo(() => {
    const counts = {};
    for (const r of sheet?.rows || []) {
      const t = testOf(r);
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
      .map((t) => ({ value: t, label: t, count: counts[t] }));
  }, [sheet?.rows, testOf]);
  const activeTests = tests.filter((t) => testOptions.some((o) => o.value === t));
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

  // Rows after year / month / search. The QC and Re-Sequencing counts in the summary strip
  // are taken from here, so they stay meaningful while those two filters are being clicked.
  const searchText = query.trim().toLowerCase();
  const baseRows = useMemo(
    () =>
      inYear.filter((r) => {
        if (activeMonths.length > 0 && !activeMonths.includes(partsOf(r).m)) return false;
        if (activeTests.length > 0 && !activeTests.includes(testOf(r))) return false;
        if (!searchText) return true;
        return Object.values(r.cells).some((v) => String(v ?? "").toLowerCase().includes(searchText));
      }),
    [inYear, activeMonths, activeTests, partsOf, testOf, searchText]
  );
  const visibleRows = useMemo(
    () => baseRows.filter((r) => (qcs.length === 0 || qcs.includes(r.qc_pass)) && (reseqs.length === 0 || reseqs.includes(r.resequencing))),
    [baseRows, qcs, reseqs]
  );
  const filtered = activeYears.length > 0 || activeMonths.length > 0 || activeTests.length > 0 || qcs.length > 0 || reseqs.length > 0 || !!searchText;

  if (error) {
    return (
      <div className="h-full overflow-auto p-4">
        <Alert kind="error">{error}</Alert>
      </div>
    );
  }
  if (!sheet || switching) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-brand-700 py-16">
        <Spinner />
        <span className="text-xs text-slate-400">Loading samples…</span>
      </div>
    );
  }

  const idCol = colFor("sampleid");
  const hasSampleColumns = !!idCol;
  const selected = openRow === null ? null : sheet.rows.find((r) => r.row_index === openRow);
  const selectedPos = selected ? visibleRows.findIndex((r) => r.row_index === selected.row_index) : -1;

  const stats = {
    total: baseRows.length,
    pass: baseRows.filter((r) => r.qc_pass === "Pass").length,
    fail: baseRows.filter((r) => r.qc_pass === "Fail").length,
    reseq: baseRows.filter((r) => r.resequencing === "Yes").length,
  };
  // Exports exactly what the table is showing (so every filter applies), with the same
  // columns, DD/MM/YYYY dates, and the current QC Pass / Re-Sequencing values.
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
        activeTests.map((t) => t.replace(/[^A-Za-z0-9]+/g, "")).join("-"),
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
    setTests([]);
    setQcs([]);
    setReseqs([]);
    setQuery("");
  };
  const emptyState = (
    <div className="px-3 py-16 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
        <Icon name={sheet.rows.length === 0 ? "file" : "search"} size={22} />
      </div>
      <div className="text-sm font-semibold text-slate-600">
        {sheet.rows.length === 0 ? "No samples found in this workbook." : "No samples match your filters."}
      </div>
      {filtered && (
        <button onClick={resetFilters} className="mt-2 text-xs font-bold text-brand-700 hover:text-brand-900">
          Clear all filters
        </button>
      )}
    </div>
  );
  const valueOf = (row, key) => {
    const col = colFor(key);
    const raw = col ? row.cells[col] : null;
    return key === "date" ? formatDate(raw) : isBlank(raw) ? null : String(raw);
  };
  const goTo = (offset) => {
    const next = visibleRows[selectedPos + offset];
    if (next) setOpenRow(next.row_index);
  };

  return (
    <div ref={setRootEl} className={expanded ? "fixed inset-0 z-40 flex flex-col min-h-0 bg-white" : "h-full flex flex-col min-h-0 bg-white"}>
      {/* Header, kept to two slim rows so the table gets the height:
          row 1  title + count            | Filter / Export / Full screen
          row 2  search + clickable counts (scrolls sideways if it must)           */}
      <div className="px-3 sm:px-4 py-2.5 bg-gradient-to-r from-brand-50 to-white border-b border-slate-200 shrink-0 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-white items-center justify-center shrink-0 shadow">
            <Icon name="dna" size={18} />
          </div>
          <div className="min-w-0 mr-auto">
            <div className="text-sm sm:text-base font-extrabold text-slate-800 leading-tight truncate">Sample information</div>
            <div className="text-[11px] sm:text-xs text-slate-500 truncate">
              {filtered ? `Showing ${visibleRows.length} of ${sheet.rows.length}` : `${sheet.rows.length} samples`}
              <span className="hidden sm:inline"> · Run {runNumber}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasSampleColumns && (
              <FilterMenu
                yearOptions={yearOptions}
                years={activeYears}
                onToggleYear={(v) => toggle(years, setYears, v)}
                onAllYears={() => setYears([])}
                monthOptions={monthOptions}
                months={activeMonths}
                onToggleMonth={(v) => toggle(months, setMonths, v)}
                testOptions={testOptions}
                tests={activeTests}
                onToggleTest={(v) => toggle(tests, setTests, v)}
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
              className={`${BTN} disabled:opacity-45 disabled:cursor-not-allowed`}
              title={filtered ? "Export the filtered samples to Excel" : "Export all samples to Excel"}
              aria-label="Export to Excel"
            >
              <Icon name="download" size={13} />
              <span className="hidden md:inline">Export</span>
            </button>
            {onDownload && (
              <button onClick={onDownload} className={BTN} title="Download the original Excel file" aria-label="Download the original file">
                <Icon name="file" size={13} />
                <span className="hidden lg:inline">Original</span>
              </button>
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              className={BTN}
              title={expanded ? "Back to the page (Esc)" : "Open full screen for more room"}
              aria-label={expanded ? "Close full screen" : "Full screen"}
            >
              <Icon name={expanded ? "x" : "panelLeft"} size={13} />
              <span className="hidden md:inline">{expanded ? "Close" : "Full screen"}</span>
            </button>
          </div>
        </div>

        {hasSampleColumns && (
          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
            <label className="relative flex items-center w-full sm:w-52 sm:shrink-0">
              <Icon name="search" size={14} className="pointer-events-none absolute left-3 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search samples…"
                aria-label="Search samples"
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-xs shadow-sm placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto pb-0.5">
              <SummaryPill
                tone="slate"
                label="Samples"
                value={stats.total}
                active={qcs.length === 0 && reseqs.length === 0}
                onClick={() => {
                  setQcs([]);
                  setReseqs([]);
                }}
                title="Show all"
              />
              <SummaryPill tone="blue" label="Pass" value={stats.pass} active={qcs.length === 1 && qcs[0] === "Pass"} onClick={() => setQcs(qcs.length === 1 && qcs[0] === "Pass" ? [] : ["Pass"])} title="Show only QC Pass" />
              <SummaryPill tone="orange" label="Fail" value={stats.fail} active={qcs.length === 1 && qcs[0] === "Fail"} onClick={() => setQcs(qcs.length === 1 && qcs[0] === "Fail" ? [] : ["Fail"])} title="Show only QC Fail" />
              <SummaryPill tone="violet" label="Re-seq" value={stats.reseq} active={reseqs.length === 1 && reseqs[0] === "Yes"} onClick={() => setReseqs(reseqs.length === 1 && reseqs[0] === "Yes" ? [] : ["Yes"])} title="Show only samples marked for re-sequencing" />
            </div>
          </div>
        )}
        {hasSampleColumns && !canEditQC && (
          <div className="hidden md:block text-[11px] text-slate-400 -mt-1">QC Pass / Re-Sequencing are set by the Primary Team Head.</div>
        )}
      </div>

      {saveError && (
        <div className="px-4 pt-3 shrink-0">
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
        <div className="flex-1 min-h-0">
          <div className="h-full flex flex-col bg-white">
            <div className={narrow ? "hidden" : "flex-1 min-h-0 overflow-auto"}>
              <table className="w-full min-w-[72rem] text-sm border-separate border-spacing-0">
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
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), setOpenRow(row.row_index))}
                      className={`group cursor-pointer transition-colors hover:bg-brand-50 focus:outline-none focus:bg-brand-50 ${
                        row.qc_pass === "Fail" ? "bg-accent-50/60" : i % 2 ? "bg-slate-50/50" : "bg-white"
                      }`}
                    >
                      {INFO_COLUMNS.map((c) => {
                        const col = colFor(c.key);
                        const raw = col ? row.cells[col] : null;
                        const val = c.date ? formatDate(raw) : isBlank(raw) ? null : String(raw);
                        if (c.key === "samplename") {
                          return (
                            <td key={c.key} className={`${TD} max-w-[17rem]`} title={val || ""}>
                              {val === null ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                <span className="block truncate font-semibold text-slate-900">{val}</span>
                              )}
                            </td>
                          );
                        }
                        return (
                          <td
                            key={c.key}
                            className={`${TD} max-w-[15rem] truncate text-slate-600 ${
                              c.mono ? "sticky left-0 z-10 bg-inherit border-r border-r-slate-200" : ""
                            }`}
                            title={val || ""}
                          >
                            <CellValue col={c} val={val} />
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
                      <td colSpan={INFO_COLUMNS.length + 2}>{emptyState}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Phones and narrow panes: one card per sample instead of an 11-column table */}
            <div className={narrow ? "flex-1 min-h-0 overflow-auto divide-y divide-slate-100" : "hidden"}>
              {visibleRows.map((row) => {
                const name = valueOf(row, "samplename");
                const sub = [valueOf(row, "description"), valueOf(row, "client")].filter(Boolean).join(" · ");
                const date = valueOf(row, "date");
                const test = valueOf(row, "test");
                const gender = valueOf(row, "genderigv") || valueOf(row, "gendertrf");
                return (
                  <div
                    key={row.row_index}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenRow(row.row_index)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), setOpenRow(row.row_index))}
                    className={`px-3.5 py-3.5 active:bg-brand-50 focus:outline-none focus:bg-brand-50 ${row.qc_pass === "Fail" ? "bg-accent-50/60" : "bg-white"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900 truncate">{name ?? "—"}</div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          <CellValue col={INFO_COLUMNS[0]} val={valueOf(row, "sampleid")} />
                          {test && <TestTag value={test} />}
                          {gender && <GenderChip value={gender} />}
                        </div>
                        {(sub || date) && (
                          <div className="mt-1.5 text-xs text-slate-500 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                            {sub && <span className="truncate max-w-full">{sub}</span>}
                            {date && (
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <Icon name="calendar" size={12} className="text-slate-300" />
                                {date}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <Icon name="chevronRight" size={16} className="text-slate-300 mt-2 shrink-0" />
                    </div>
                    <div className="mt-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
                      <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500" onClick={(e) => e.stopPropagation()}>
                        QC
                        <StatusSelect
                          label="QC Pass"
                          value={row.qc_pass}
                          options={QC_OPTIONS}
                          editable={canEditQC}
                          busy={!!saving[`${row.row_index}:qc_pass`]}
                          onChange={(v) => updateQC(row.row_index, "qc_pass", v)}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500" onClick={(e) => e.stopPropagation()}>
                        Re-seq
                        <StatusSelect
                          label="Re-Sequencing"
                          value={row.resequencing}
                          options={RESEQ_OPTIONS}
                          editable={canEditQC}
                          busy={!!saving[`${row.row_index}:resequencing`]}
                          onChange={(v) => updateQC(row.row_index, "resequencing", v)}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
              {visibleRows.length === 0 && emptyState}
            </div>
            <div className="shrink-0 px-4 py-2 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between text-[11px] text-slate-400">
              <span>Tap a sample to open its Fastp and HS metrics</span>
              <span className="tabular-nums">
                {visibleRows.length} of {sheet.rows.length}
              </span>
            </div>
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
          onDownloadPdf={() => downloadSampleReport(runNumber, selected.row_index, selected.cells[idCol])}
          onPrev={selectedPos > 0 ? () => goTo(-1) : undefined}
          onNext={selectedPos >= 0 && selectedPos < visibleRows.length - 1 ? () => goTo(1) : undefined}
          position={selectedPos >= 0 ? `${selectedPos + 1} of ${visibleRows.length}` : undefined}
        />
      )}
    </div>
  );
}

// ---- sample popup ------------------------------------------------------------------

function Section({ icon, title, hint, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <h3 className="px-4 py-3 border-b border-slate-100 flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
          <Icon name={icon} size={15} />
        </span>
        <span className="text-sm font-extrabold text-slate-800">{title}</span>
        {hint && <span className="ml-auto text-[11px] font-semibold text-slate-400">{hint}</span>}
      </h3>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{label}</div>
      <div className="text-sm mt-1 break-words text-slate-800">{children}</div>
    </div>
  );
}

function MetricTile({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400 break-words">{label}</div>
      <div className={`text-sm font-bold mt-0.5 break-words tabular-nums ${value ? "text-slate-800" : "text-slate-300"}`}>{value ?? "—"}</div>
    </div>
  );
}

/** "103.797322 M" -> 103.797322 (millions of reads); null if it can't be read as a number. */
function readsInMillions(v) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function SampleModal({ row, colFor, idCol, metrics, canEditQC, saving, onChange, onClose, footerNote, onPrev, onNext, position, onDownloadPdf }) {
  const [hsQuery, setHsQuery] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);

  async function downloadPdf() {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await onDownloadPdf();
    } catch (e) {
      setPdfError(e.message || "Could not create the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") return onClose();
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onPrev, onNext]);

  // A different sample starts with a clean metric search.
  useEffect(() => {
    setHsQuery("");
    setPdfError(null);
  }, [row.row_index]);

  const sampleId = String(row.cells[idCol] ?? "").trim();
  const fastp = metrics?.fastp?.[sampleId];
  const hs = metrics?.hs?.[sampleId];
  const hsOrder = metrics?.hs_metrics || [];

  const grouped = useMemo(() => {
    const q = hsQuery.trim().toLowerCase();
    const groups = HS_GROUPS.map((g) => ({ title: g.title, names: [] }));
    const other = { title: "Other", names: [] };
    for (const name of hsOrder) {
      if (q && !name.toLowerCase().includes(q)) continue;
      const g = HS_GROUPS.findIndex((x) => x.match.test(name));
      (g === -1 ? other : groups[g]).names.push(name);
    }
    return [...groups, other].filter((g) => g.names.length);
  }, [hsOrder, hsQuery]);

  const highlights = useMemo(() => {
    if (!hs) return [];
    return HS_HIGHLIGHTS.map((h) => {
      const name = hsOrder.find((n) => h.match.test(n));
      return name ? { label: h.label, name, value: formatMetric(hs[name]) } : null;
    }).filter((h) => h && h.value);
  }, [hs, hsOrder]);

  const info = (key, opts = {}) => {
    const col = colFor(key);
    const raw = col ? row.cells[col] : null;
    if (isBlank(raw)) return null;
    return opts.date ? formatDate(raw) : String(raw);
  };

  const name = info("samplename") || sampleId || "Sample";
  const subtitle = [info("test"), info("client")].filter(Boolean).join(" · ");

  const beforeReads = readsInMillions(fastp?.before?.reads);
  const afterReads = readsInMillions(fastp?.after?.reads);
  const retained = beforeReads && afterReads ? `${((afterReads / beforeReads) * 100).toFixed(2)}%` : null;

  const qcControls = (
    <div className="flex items-center gap-5 flex-wrap">
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

  const navBtn = "w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:hover:bg-white/15 disabled:cursor-not-allowed";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6 bg-slate-900/55 backdrop-blur-[3px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Sample ${sampleId}`}
    >
      <div
        className="fade-up bg-slate-100 sm:rounded-3xl shadow-2xl w-full max-w-5xl sm:max-h-[92vh] h-full sm:h-auto flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-3.5 sm:px-5 py-3 sm:py-4 bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 text-white flex items-center gap-2.5 sm:gap-4 flex-wrap sm:flex-nowrap shrink-0">
          <div className="min-w-0 flex-1 basis-40">
            <div className="text-base sm:text-lg font-extrabold truncate leading-tight">{name}</div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="font-mono text-xs bg-white/15 rounded-md px-2 py-0.5 truncate">{sampleId}</span>
              {subtitle && <span className="text-xs text-brand-100 truncate">{subtitle}</span>}
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <StatusSelect label="QC Pass" value={row.qc_pass} options={QC_OPTIONS} editable={false} />
            <StatusSelect label="Re-Sequencing" value={row.resequencing} options={RESEQ_OPTIONS} editable={false} />
          </div>
          {(onPrev || onNext) && (
            <div className="flex items-center gap-1.5 shrink-0 order-last sm:order-none w-full sm:w-auto justify-center sm:justify-start">
              <button className={navBtn} onClick={onPrev} disabled={!onPrev} title="Previous sample (←)" aria-label="Previous sample">
                <Icon name="chevronLeft" size={16} />
              </button>
              {position && <span className="text-[11px] font-semibold text-brand-100 tabular-nums w-14 text-center">{position}</span>}
              <button className={navBtn} onClick={onNext} disabled={!onNext} title="Next sample (→)" aria-label="Next sample">
                <Icon name="chevronRight" size={16} />
              </button>
            </div>
          )}
          {onDownloadPdf && (
            <button
              onClick={downloadPdf}
              disabled={pdfBusy}
              className="w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 text-white shrink-0 order-2 sm:order-none ml-auto sm:ml-0 flex items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-wait"
              title="Download this sample as a PDF"
              aria-label="Download PDF"
            >
              {pdfBusy ? <Spinner /> : <Icon name="download" size={18} />}
            </button>
          )}
          <button onClick={onClose} className={`text-white/80 hover:text-white shrink-0 order-2 sm:order-none ${onDownloadPdf ? "" : "ml-auto sm:ml-0"}`} title="Close (Esc)" aria-label="Close">
            <Icon name="x" size={22} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 sm:space-y-4">
          <Section icon="clipboard" title="Sample Information">
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 gap-2.5">
              {INFO_COLUMNS.map((c) => {
                const v = info(c.key, c);
                return (
                  <Field key={c.key} label={c.label}>
                    {v === null ? <span className="text-slate-300">—</span> : <CellValue col={c} val={v} />}
                  </Field>
                );
              })}
              <Field label="QC Pass">
                <StatusSelect label="QC Pass" value={row.qc_pass} options={QC_OPTIONS} editable={false} />
              </Field>
              <Field label="Re-Sequencing">
                <StatusSelect label="Re-Sequencing" value={row.resequencing} options={RESEQ_OPTIONS} editable={false} />
              </Field>
            </div>
          </Section>

          <Section icon="activity" title="Fastp Metrics" hint={retained ? `${retained} of reads retained` : undefined}>
            {!metrics ? (
              <div className="flex justify-center py-4 text-brand-700">
                <Spinner />
              </div>
            ) : !fastp ? (
              <p className="text-sm text-slate-400">No Fastp metrics found for this Sample_ID in the workbook.</p>
            ) : (
              <div className="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
                {[
                  ["Before Fastp", "before", "border-accent-200 bg-accent-50/40", "text-accent-700"],
                  ["After Fastp", "after", "border-brand-200 bg-brand-50/40", "text-brand-700"],
                ].map(([title, part, box, head], i) => (
                  <div key={part} className={`contents`}>
                    {i === 1 && (
                      <div className="hidden md:flex items-center text-slate-300">
                        <Icon name="chevronRight" size={22} />
                      </div>
                    )}
                    <div className={`rounded-xl border p-3 ${box}`}>
                      <div className={`text-[11px] font-extrabold uppercase tracking-wider mb-2 ${head}`}>{title}</div>
                      <div className="grid grid-cols-2 gap-2">
                        {FASTP_FIELDS.map((f) => (
                          <MetricTile key={f.key} label={f.label} value={formatMetric(fastp[part]?.[f.key])} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon="layers" title="HS Metrics" hint={hs ? `${hsOrder.length} metrics` : undefined}>
            {!metrics ? (
              <div className="flex justify-center py-4 text-brand-700">
                <Spinner />
              </div>
            ) : !hs ? (
              <p className="text-sm text-slate-400">No HS metrics found for this Sample_ID in the workbook.</p>
            ) : (
              <div className="space-y-4">
                {highlights.length > 0 && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {highlights.map((h) => (
                      <div key={h.name} className="rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 text-white px-3.5 py-3 shadow-sm">
                        <div className="text-[10px] uppercase tracking-wider font-bold text-brand-200">{h.label}</div>
                        <div className="text-xl font-extrabold mt-1 tabular-nums break-words">{h.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                <label className="relative flex items-center">
                  <Icon name="search" size={14} className="pointer-events-none absolute left-3 text-slate-400" />
                  <input
                    type="search"
                    value={hsQuery}
                    onChange={(e) => setHsQuery(e.target.value)}
                    placeholder="Find a metric, e.g. coverage or 30X…"
                    aria-label="Find a metric"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </label>

                {grouped.length === 0 && <p className="text-sm text-slate-400">No metric matches “{hsQuery}”.</p>}
                {grouped.map((g) => (
                  <div key={g.title}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{g.title}</span>
                      <span className="flex-1 h-px bg-slate-200" />
                      <span className="text-[10px] font-bold text-slate-400 tabular-nums">{g.names.length}</span>
                    </div>
                    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 gap-2">
                      {g.names.map((metric) => (
                        <MetricTile key={metric} label={metric} value={formatMetric(hs[metric])} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <footer className="px-3.5 sm:px-5 py-3 bg-white border-t border-slate-200 flex items-center gap-x-4 gap-y-2 flex-wrap shrink-0">
          {qcControls}
          {!canEditQC && <span className="text-[11px] text-slate-400">{footerNote ?? "Only the Primary Team Head can change these."}</span>}
          {pdfError && <span className="text-xs font-semibold text-accent-700">{pdfError}</span>}
          <button className="btn-ghost ml-auto py-1.5 px-4 text-xs" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
