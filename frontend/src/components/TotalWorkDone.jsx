import { useEffect, useState } from "react";
import { api, downloadTotalWorkDone } from "../api";
import DashArt from "./DashArt";
import PeriodFilter, { periodLabel } from "./PeriodFilter";
import RunListDialog from "./RunListDialog";
import SampleListDialog from "./SampleListDialog";
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
  const [listing, setListing] = useState(null); // which headline card's samples are open
  const [period, setPeriod] = useState({ year: "all", month: "all", run: "all" }); // month/year/run filter

  async function exportAs(format) {
    setMenuOpen(false);
    setExporting(format);
    setExportError(null);
    try {
      await downloadTotalWorkDone(format, period);
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
      .getTotalWorkDone(period)
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
  }, [refreshKey, reloadTick, period]);

  const s = data?.sample;
  const qc = data?.qc;
  const meta = data?.meta;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[14rem]">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Total work done</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {meta
              ? `${meta.files_processed} of ${meta.folders_scanned} work folder${meta.folders_scanned === 1 ? "" : "s"} counted`
              : "Samples and QC across all work folders"}
            {period.run !== "all" && <span className="text-brand-700 font-medium"> · {period.run}</span>}
            {periodLabel(period.year, period.month) && (
              <span className="text-brand-700 font-medium"> · {periodLabel(period.year, period.month)}</span>
            )}
          </p>
        </div>

        {loading && data && <Spinner className="text-slate-400" />}
        {(data?.meta?.periods?.length > 0 || period.year !== "all" || period.month !== "all") && (
          <PeriodFilter
            periods={data?.meta?.periods ?? []}
            year={period.year}
            month={period.month}
            onChange={(p) => setPeriod((cur) => ({ ...cur, ...p }))}
          />
        )}
        {(data?.meta?.run_options?.length > 0 || period.run !== "all") && (
          <label className="relative inline-flex items-center">
            <Icon name="flask" size={14} className="absolute left-3 text-slate-400 pointer-events-none" />
            <select
              className="btn-ghost bg-white py-2 pl-8 pr-3 text-xs appearance-none cursor-pointer"
              value={period.run}
              onChange={(e) => setPeriod((cur) => ({ ...cur, run: e.target.value }))}
              aria-label="Filter by run"
            >
              <option value="all">All runs</option>
              {(data?.meta?.run_options ?? []).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <BigCard label="Total runs" art="runs" tone="violet" value={data.runs?.total ?? 0} caption="All runs in the system" noun="runs" onOpen={() => setListing({ category: "runs", title: "Total runs", tone: "violet" })} />
            <BigCard label="Total samples" art="samples" tone="blue" value={s.total} caption="In approved runs" onOpen={() => setListing({ category: "total", title: "Total samples", tone: "blue" })} />
            <BigCard label="QC pass" art="pass" tone="green" value={qc.pass} caption="Samples that passed" onOpen={() => setListing({ category: "pass", title: "QC pass", tone: "green" })} />
            <BigCard label="QC fail" art="fail" tone="red" value={qc.fail} caption="Samples that failed" onOpen={() => setListing({ category: "fail", title: "QC fail", tone: "red" })} />
            <BigCard label="Resequence" art="repeat" tone="orange" value={qc.resequence} caption="Flagged to repeat" onOpen={() => setListing({ category: "resequence", title: "Resequence", tone: "orange" })} />
          </div>

          {/* ---- samples by test type ---- */}
          <Block title="Samples by test type">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <SmallCard label="WES" onOpen={() => setListing({ category: "wes", title: "WES", tone: "blue" })} icon="dna" tone="blue" value={s.wes.total} note={`WES ${s.wes.wes} · + Mito ${s.wes.wes_mito}`} />
              <SmallCard label="WGS" onOpen={() => setListing({ category: "wgs", title: "WGS", tone: "violet" })} icon="layers" tone="violet" value={s.wgs} />
              <SmallCard label="Panel" onOpen={() => setListing({ category: "panel", title: "Panel", tone: "teal" })} icon="grid" tone="teal" value={s.panel} />
              <SmallCard label="Mito" onOpen={() => setListing({ category: "mito", title: "Mito", tone: "amber" })} icon="activity" tone="amber" value={s.mito} note="Standalone" />
              <SmallCard label="CES" onOpen={() => setListing({ category: "ces", title: "CES", tone: "pink" })} icon="flask" tone="pink" value={s.ces} />
              <SmallCard label="Others" onOpen={() => setListing({ category: "others", title: "Others", tone: "slate" })} icon="moreCircle" tone="slate" value={s.others} />
            </div>
          </Block>

          {/* ---- report results (not tracked yet) ---- */}
          <Block title="Report">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SmallCard label="Positive" icon="plusCircle" tone="indigo" value="-" />
              <SmallCard label="Negative" icon="minusCircle" tone="sky" value="-" />
            </div>
          </Block>
        </>
      ) : null}

      {listing?.category === "runs" && (
        <RunListDialog runs={data?.runs?.items || []} tone={listing.tone} onClose={() => setListing(null)} />
      )}
      {listing && listing.category !== "runs" && (
        <SampleListDialog
          category={listing.category}
          period={period}
          title={listing.title}
          tone={listing.tone}
          onClose={() => setListing(null)}
        />
      )}
    </section>
  );
}

/** A section label with a hairline running out to the right. */
function Block({ title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600">{title}</h3>
        <span className="h-px flex-1 bg-slate-300/70" />
      </div>
      {children}
    </div>
  );
}

/** A headline card: label, large number, short caption, and an illustration. Clicking
 * it opens the list of samples behind the number. */
function BigCard({ label, art, tone, value, caption, onOpen, noun = "samples" }) {
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      {...(onOpen ? { type: "button", onClick: onOpen, title: `Show the ${label.toLowerCase()} ${noun}` } : {})}
      className={`dcard tone-${tone} group w-full text-left ${onOpen ? "cursor-pointer" : ""} px-5 py-5 flex items-center justify-between gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400`}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-700">{label}</div>
        <div className="dnum text-5xl font-extrabold mt-1 tabular-nums tracking-tight leading-none">
          {value.toLocaleString()}
        </div>
        <div className="text-xs text-slate-500 mt-2.5 flex items-center gap-1">
          {caption}
          {onOpen && <Icon name="chevronRight" size={13} className="dicon opacity-60 transition-transform group-hover:translate-x-0.5" />}
        </div>
      </div>
      <DashArt name={art} size={68} className="dicon shrink-0" />
    </Tag>
  );
}

/** A compact card for one category. */
function SmallCard({ label, icon, tone, value, note, onOpen }) {
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      {...(onOpen ? { type: "button", onClick: onOpen, title: `Show the ${label} samples` } : {})}
      className={`dcard tone-${tone} p-4 flex items-start justify-between gap-3 w-full text-left ${onOpen ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400" : ""}`}
    >
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
    </Tag>
  );
}
