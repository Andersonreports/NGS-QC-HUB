import { useEffect, useState } from "react";
import { api, downloadTotalWorkDone } from "../api";
import DashArt from "./DashArt";
import { Alert, Icon, Spinner } from "./ui";

// Formats the Export menu offers — keep in sync with EXPORT_FORMATS in
// backend/app/routers/dashboard.py. Add an entry here once the backend supports it.
const EXPORT_FORMATS = [{ id: "pdf", label: "PDF document" }];

/**
 * "Total Work Done": the headline numbers (samples and QC), the sample breakdown by
 * test type, and the report results. The backend does all the counting from the
 * approved runs; this component only fetches and displays. `refreshKey` changes
 * whenever the run list does, so new uploads show up without a page reload.
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
    <section className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[14rem]">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Total work done</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {meta
              ? `${meta.files_processed} of ${meta.folders_scanned} work folder${meta.folders_scanned === 1 ? "" : "s"} counted`
              : "Samples and QC across all work folders"}
          </p>
        </div>

        {loading && data && <Spinner className="text-slate-400" />}
        <button className="btn-ghost bg-white py-2 px-3.5 text-xs" onClick={() => setReloadTick((t) => t + 1)}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
        <div className="relative">
          <button
            className="btn-ghost bg-white py-2 px-3.5 text-xs"
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
              <div className="absolute right-0 mt-2 w-48 card shadow-lg z-20 p-1" role="menu">
                <p className="px-3 pt-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-400">
                  Export as
                </p>
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    role="menuitem"
                    className="w-full text-left px-3 py-2 rounded-md text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5"
                    onClick={() => exportAs(f.id)}
                  >
                    <Icon name="file" size={15} className="text-slate-400" /> {f.label}
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
        <div className="card p-10 flex items-center justify-center gap-2.5 text-sm text-slate-500">
          <Spinner /> Calculating totals…
        </div>
      ) : data ? (
        <>
          {/* ---- headline numbers ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <BigCard label="Total samples" art="samples" tone="blue" value={s.total} caption="In approved runs" />
            <BigCard label="QC pass" art="pass" tone="green" value={qc.pass} caption="Samples that passed" />
            <BigCard label="QC fail" art="fail" tone="red" value={qc.fail} caption="Samples that failed" />
            <BigCard label="Resequence" art="repeat" tone="orange" value={qc.resequence} caption="Flagged to repeat" />
          </div>

          {/* ---- samples by test type ---- */}
          <Block title="Samples by test type">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <SmallCard label="WES" icon="dna" tone="blue" value={s.wes.total} note={`WES ${s.wes.wes} · + Mito ${s.wes.wes_mito}`} />
              <SmallCard label="WGS" icon="layers" tone="violet" value={s.wgs} />
              <SmallCard label="Panel" icon="grid" tone="teal" value={s.panel} />
              <SmallCard label="Mito" icon="activity" tone="amber" value={s.mito} note="Standalone" />
              <SmallCard label="CES" icon="flask" tone="pink" value={s.ces} />
              <SmallCard label="Others" icon="moreCircle" tone="slate" value={s.others} />
            </div>
          </Block>

          {/* ---- report results (not tracked yet) ---- */}
          <Block title="Report">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SmallCard label="Positive" icon="plusCircle" tone="indigo" value="-" />
              <SmallCard label="Negative" icon="minusCircle" tone="sky" value="-" />
              <SmallCard label="VUS" icon="helpCircle" tone="fuchsia" value="-" />
            </div>
          </Block>
        </>
      ) : null}

      {meta?.skipped?.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer select-none flex items-center gap-2">
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

/** A section label with a hairline running out to the right. */
function Block({ title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">{title}</h3>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      {children}
    </div>
  );
}

/** A headline card: label, large number, short caption, and an illustration. */
function BigCard({ label, art, tone, value, caption }) {
  return (
    <div className={`dcard tone-${tone} px-5 py-5 flex items-center justify-between gap-4`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-700">{label}</div>
        <div className="dnum text-5xl font-extrabold mt-1 tabular-nums tracking-tight leading-none">
          {value.toLocaleString()}
        </div>
        <div className="text-xs text-slate-500 mt-2.5">{caption}</div>
      </div>
      <DashArt name={art} size={68} className="dicon shrink-0" />
    </div>
  );
}

/** A compact card for one category. */
function SmallCard({ label, icon, tone, value, note }) {
  return (
    <div className={`dcard tone-${tone} p-4 flex items-start justify-between gap-3`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-700">{label}</div>
        <div className="dnum text-3xl font-bold mt-0.5 tabular-nums tracking-tight leading-tight">
          {value.toLocaleString()}
        </div>
        {note && <div className="text-[0.7rem] leading-snug text-slate-500 mt-1">{note}</div>}
      </div>
      <span className="dtile w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
        <Icon name={icon} size={20} strokeWidth={1.7} />
      </span>
    </div>
  );
}
