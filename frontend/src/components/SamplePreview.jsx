import { useCallback, useEffect, useMemo, useState } from "react";
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

function formatDate(v) {
  if (isBlank(v)) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(v);
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

  useEffect(() => {
    let alive = true;
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

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white flex items-center gap-3 flex-wrap shrink-0">
        <div className="w-8 h-8 rounded-lg bg-brand-700 text-white flex items-center justify-center shrink-0">
          <Icon name="dna" size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800">Sample information</div>
          <div className="text-[11px] text-slate-500">
            {sheet.rows.length} sample{sheet.rows.length === 1 ? "" : "s"} · click a row for Fastp and HS metrics
          </div>
        </div>
        {!canEditQC && <span className="ml-auto text-[11px] text-slate-400">QC Pass / Re-Sequencing are set by the Primary Team Head</span>}
      </div>

      {saveError && (
        <div className="px-4 pt-3 shrink-0">
          <Alert kind="error" onDismiss={() => setSaveError(null)}>
            {saveError}
          </Alert>
        </div>
      )}

      {!hasSampleColumns ? (
        <div className="p-4">
          <Alert kind="info">
            The sheet is loaded from the “{sheet.source_sheet_name || "unknown"}” tab, which has no Sample_ID column, and this
            workbook has no Sample-Info tab to switch to, so there is no sample table to show.
          </Alert>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                {INFO_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-wide font-bold text-slate-500 px-3 py-2.5 border-b border-slate-200 whitespace-nowrap"
                  >
                    {c.label}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-brand-50 text-left text-[11px] uppercase tracking-wide font-bold text-brand-800 px-3 py-2.5 border-b border-slate-200 whitespace-nowrap">
                  QC Pass
                </th>
                <th className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-wide font-bold text-slate-500 px-3 py-2.5 border-b border-slate-200 whitespace-nowrap">
                  Re-Sequencing
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => (
                <tr
                  key={row.row_index}
                  onClick={() => setOpenRow(row.row_index)}
                  className="group cursor-pointer hover:bg-brand-50/60 transition-colors"
                >
                  {INFO_COLUMNS.map((c) => {
                    const col = colFor(c.key);
                    const raw = col ? row.cells[col] : null;
                    const val = c.date ? formatDate(raw) : isBlank(raw) ? null : String(raw);
                    return (
                      <td
                        key={c.key}
                        className={`px-3 py-2 border-b border-slate-100 max-w-[16rem] truncate ${c.mono ? "font-mono text-xs text-brand-800" : "text-slate-700"}`}
                        title={val || ""}
                      >
                        {val ?? <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 border-b border-slate-100 whitespace-nowrap">
                    <StatusSelect
                      label="QC Pass"
                      value={row.qc_pass}
                      options={QC_OPTIONS}
                      editable={canEditQC}
                      busy={!!saving[`${row.row_index}:qc_pass`]}
                      onChange={(v) => updateQC(row.row_index, "qc_pass", v)}
                    />
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100 whitespace-nowrap">
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
              {sheet.rows.length === 0 && (
                <tr>
                  <td colSpan={INFO_COLUMNS.length + 2} className="px-3 py-10 text-center text-slate-400">
                    No samples found in this workbook.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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

function SampleModal({ row, colFor, idCol, metrics, canEditQC, saving, onChange, onClose }) {
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
          {!canEditQC && <span className="text-[11px] text-slate-400">Only the Primary Team Head can change these.</span>}
          <button className="btn-ghost ml-auto py-1.5 px-3 text-xs" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
