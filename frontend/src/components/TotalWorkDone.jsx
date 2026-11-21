import { useEffect, useState } from "react";
import { api, downloadTotalWorkDone } from "../api";
import { Alert, Icon, Spinner } from "./ui";

// Formats the Export menu offers — keep in sync with EXPORT_FORMATS in
// backend/app/routers/dashboard.py. Add an entry here once the backend supports it.
const EXPORT_FORMATS = [{ id: "pdf", label: "PDF document" }];

// Every card has its own colour theme (the .tone-* classes in index.css). Green and
// red are reserved for QC Pass and Fail so those two read at a glance.

/**
 * "Total Work Done": Sample, QC and Report totals across every work folder, computed
 * by the backend from the consolidated Excel files. This component only fetches and
 * displays — no counting happens here. `refreshKey` changes whenever the run list
 * does, so new uploads show up without a page reload.
 */
export default function TotalWorkDone({ refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [exportError, setExportError] = useState(null);

  async function exportAs(format) {
    setMenuOpen(false);
    setExporting(format);
    setExportError(null);
    try {
      await downloadTotalWorkDone(format);
    } catch (e) {
      setExportError(e.message);
    } finally {
      setExporting(null);
    }
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getTotalWorkDone()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [refreshKey, reloadTick]);

  const s = data?.sample;
  const qc = data?.qc;
  const meta = data?.meta;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-[14rem]">
          <span className="tone-blue gtile w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
            <Icon name="activity" size={20} />
          </span>
          <div>
            <h2 className="text-lg font-extrabold leading-tight tracking-tight">Total work done</h2>
            <p className="text-sm text-slate-500">
              {meta
                ? `Across ${meta.files_processed} of ${meta.folders_scanned} work folder${meta.folders_scanned === 1 ? "" : "s"}`
                : "Samples, QC and reports across all work folders"}
            </p>
          </div>
        </div>

        {loading && data && <Spinner className="text-slate-400" />}
        <button className="btn-glass py-2 px-3.5 text-xs" onClick={() => setReloadTick((t) => t + 1)}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
        <div className="relative">
          <button
            className="btn-glass py-2 px-3.5 text-xs"
            disabled={!data || exporting !== null}
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {exporting ? <Spinner className="text-slate-400" /> : <Icon name="download" size={14} />} Export
            <Icon name="chevronDown" size={13} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-2 w-52 glass z-20 p-1.5" role="menu">
                <p className="px-2.5 pt-1 pb-1.5 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">
                  Export as
                </p>
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    role="menuitem"
                    className="w-full text-left px-2.5 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-brand-50 transition-colors flex items-center gap-2.5"
                    onClick={() => exportAs(f.id)}
                  >
                    <span className="tone-red gtile w-7 h-7 rounded-lg flex items-center justify-center">
                      <Icon name="file" size={15} />
                    </span>
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      {error && <Alert kind="error">Could not load totals: {error}</Alert>}
      {exportError && <Alert kind="error" onDismiss={() => setExportError(null)}>{exportError}</Alert>}

      {!data && loading ? (
        <div className="glass p-10 flex items-center justify-center gap-2.5 text-sm text-slate-500">
          <Spinner /> Calculating totals…
        </div>
      ) : data ? (
        <div className="space-y-7">
          {/* ---- SAMPLE ---- */}
          <Group title="Sample" subtitle="Samples by test type" icon="flask" tone="blue" cols="grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
            <Stat label="WES" icon="dna" tone="blue" value={s.wes.total} className="col-span-2 md:col-span-1">
              <ul className="mt-3.5 pt-3 border-t border-white/25 space-y-1.5 text-xs text-white/85">
                <SubRow label="WES" value={s.wes.wes} />
                <SubRow label="WES + Mito" value={s.wes.wes_mito} />
              </ul>
            </Stat>
            <Stat label="WGS" icon="layers" tone="violet" value={s.wgs} />
            <Stat label="Panel" icon="grid" tone="teal" value={s.panel} />
            <Stat label="Mito" icon="activity" tone="amber" value={s.mito} hint="standalone" />
            <Stat label="CES" icon="flask" tone="pink" value={s.ces} />
            <Stat label="Others" icon="moreCircle" tone="slate" value={s.others} hint="other test types" className="col-span-2 md:col-span-1" />
          </Group>

          {/* ---- QC ---- */}
          <Group title="QC" subtitle="Quality-control outcomes" icon="shield" tone="green" cols="grid-cols-1 sm:grid-cols-3">
            <Stat label="Pass" icon="circleCheck" tone="green" value={qc.pass} />
            <Stat label="Fail" icon="circleX" tone="red" value={qc.fail} />
            <Stat label="Resequence" icon="repeat" tone="orange" value={qc.resequence} />
          </Group>

          {/* ---- REPORT (placeholders until report results are tracked) ---- */}
          <Group title="Report" subtitle="Report results" icon="clipboard" tone="violet" cols="grid-cols-1 sm:grid-cols-3">
            <Stat label="Positive" icon="plusCircle" tone="indigo" value="-" />
            <Stat label="Negative" icon="minusCircle" tone="sky" value="-" />
            <Stat label="VUS" icon="helpCircle" tone="fuchsia" value="-" />
          </Group>
        </div>
      ) : null}

      {meta?.skipped?.length > 0 && (
        <details className="glass px-4 py-3 text-xs text-slate-500">
          <summary className="cursor-pointer select-none font-medium flex items-center gap-2">
            <Icon name="info" size={14} className="text-slate-400" />
            {meta.skipped.length} folder{meta.skipped.length === 1 ? " was" : "s were"} not counted
          </summary>
          <ul className="mt-2 space-y-1 pl-6 list-disc">
            {meta.skipped.map((k) => (
              <li key={k.folder}>
                <span className="font-mono font-semibold text-slate-700">{k.folder}</span>: {k.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** A section heading (icon tile + title) above its row of cards. */
function Group({ title, subtitle, icon, tone, cols, children }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3.5">
        <span className={`tone-${tone} gtile w-9 h-9 rounded-xl flex items-center justify-center`}>
          <Icon name={icon} size={18} />
        </span>
        <h3 className="text-base font-extrabold tracking-tight text-slate-800">{title}</h3>
        <span className="text-xs text-slate-500 hidden sm:inline">{subtitle}</span>
      </div>
      <div className={`grid gap-3 sm:gap-4 ${cols}`}>{children}</div>
    </div>
  );
}

function Stat({ label, icon, tone, value, hint, className = "", children }) {
  return (
    <div className={`gcard tone-${tone} p-4 sm:p-5 ${className}`}>
      <Icon name={icon} size={92} strokeWidth={1.4} className="gcard-mark" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-white/85">{label}</span>
        <span className="gcard-icon w-9 h-9 rounded-xl flex items-center justify-center">
          <Icon name={icon} size={18} />
        </span>
      </div>
      <div className="text-4xl sm:text-5xl font-extrabold mt-2.5 tabular-nums tracking-tight drop-shadow-sm">
        {value.toLocaleString()}
      </div>
      {hint && <div className="text-[0.7rem] font-medium text-white/75 mt-0.5">{hint}</div>}
      {children}
    </div>
  );
}

function SubRow({ label, value }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
        {label}
      </span>
      <span className="font-bold tabular-nums text-white">{value.toLocaleString()}</span>
    </li>
  );
}
