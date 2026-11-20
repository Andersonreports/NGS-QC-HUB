import { useEffect, useState } from "react";
import { api, downloadTotalWorkDone } from "../api";
import { Alert, Icon, Spinner } from "./ui";

// Formats the Export menu offers — keep in sync with EXPORT_FORMATS in
// backend/app/routers/dashboard.py. Add an entry here once the backend supports it.
const EXPORT_FORMATS = [{ id: "pdf", label: "PDF document" }];

/**
 * "Total Work Done": Sample and QC totals across every work folder, computed by
 * the backend from the consolidated Excel files. This component only fetches and
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
    <section className="space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[12rem]">
          <h2 className="text-base font-bold">Total work done</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {meta
              ? `Across ${meta.files_processed} of ${meta.folders_scanned} work folder${meta.folders_scanned === 1 ? "" : "s"}.`
              : "Samples and QC across all work folders."}
          </p>
        </div>
        {loading && data && <Spinner className="text-slate-400" />}
        <button className="btn-ghost py-1.5 px-3 text-xs" onClick={() => setReloadTick((t) => t + 1)}>
          <Icon name="refresh" size={13} /> Refresh
        </button>
        <div className="relative">
          <button
            className="btn-ghost py-1.5 px-3 text-xs"
            disabled={!data || exporting !== null}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {exporting ? <Spinner className="text-slate-400" /> : <Icon name="download" size={13} />} Export
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-1 w-44 card z-20 py-1">
                <p className="px-3 py-1 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Export as</p>
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                    onClick={() => exportAs(f.id)}
                  >
                    <Icon name="file" size={14} className="text-slate-400" /> {f.label}
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
        <div className="card p-10 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Spinner /> Calculating totals…
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* ---- SAMPLE ---- */}
          <Group title="Sample" cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="WES" value={s.wes.total} className="col-span-2 sm:col-span-1">
              <ul className="mt-3 pt-3 border-t border-slate-200 space-y-1 text-xs text-slate-600">
                <SubRow label="WES" value={s.wes.wes} />
                <SubRow label="WES + Mito" value={s.wes.wes_mito} />
              </ul>
            </Stat>
            <Stat label="WGS" value={s.wgs} />
            <Stat label="Panel" value={s.panel} />
            <Stat label="Mito" value={s.mito} hint="standalone" />
            <Stat label="CES" value={s.ces} />
          </Group>

          {/* ---- QC ---- */}
          <Group title="QC" cols="grid-cols-1 sm:grid-cols-3">
            <Stat label="Pass" value={qc.pass} tone="text-brand-700" />
            <Stat label="Fail" value={qc.fail} tone="text-red-600" />
            <Stat label="Resequence" value={qc.resequence} tone="text-accent-600" />
          </Group>
        </div>
      ) : null}

      {meta?.skipped?.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer select-none">
            {meta.skipped.length} folder{meta.skipped.length === 1 ? " was" : "s were"} not counted
          </summary>
          <ul className="mt-1.5 space-y-0.5 pl-4 list-disc">
            {meta.skipped.map((k) => (
              <li key={k.folder}>
                <span className="font-mono font-semibold">{k.folder}</span>: {k.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Group({ title, cols, children }) {
  return (
    <div className="card p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">{title}</h3>
      <div className={`grid gap-3 ${cols}`}>{children}</div>
    </div>
  );
}

function Stat({ label, value, hint, tone = "text-slate-900", className = "", children }) {
  return (
    <div className={`rounded-lg border p-4 bg-white border-slate-200 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
        {hint && <span className="text-[0.7rem] text-slate-400">{hint}</span>}
      </div>
      <div className={`text-4xl font-extrabold mt-1.5 tabular-nums ${tone}`}>
        {value.toLocaleString()}
      </div>
      {children}
    </div>
  );
}

function SubRow({ label, value }) {
  return (
    <li className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="font-bold tabular-nums text-slate-800">{value.toLocaleString()}</span>
    </li>
  );
}
