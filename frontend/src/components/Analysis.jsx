import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Alert, Icon } from "./ui";
import PeriodFilter, { periodLabel } from "./PeriodFilter";

const TEST_ORDER = ["WES", "WES + Mito", "WGS", "Panel", "CES", "Mito", "Others"];
const TEST_COLORS = {
  WES: "#2563eb",
  "WES + Mito": "#7c3aed",
  WGS: "#0891b2",
  Panel: "#16a34a",
  CES: "#ea580c",
  Mito: "#db2777",
  Others: "#64748b",
};
const PASS = "#0f8a5f";
const FAIL = "#cf3030";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (n) => Number(n).toLocaleString();
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** A "nice" axis maximum and tick list for a data maximum. */
function niceScale(max, ticks = 4) {
  if (max <= 0) return { max: 1, ticks: [0, 1] };
  const step0 = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const top = Math.ceil(max / step) * step;
  const list = [];
  for (let v = 0; v <= top + 1e-9; v += step) list.push(v);
  return { max: top, ticks: list };
}

/* ------------------------------------------------------------------ shell */

/** A chart section with no box around it — a numbered heading with a big figure, then the
 * chart using the full width, with a hairline between sections. */
function Section({ n, title, subtitle, stat, statLabel, tone, children }) {
  return (
    <section className={`${tone} fade-up py-5 first:pt-1 border-b border-slate-200/80 last:border-b-0`}>
      <header className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div className="flex items-center gap-3.5">
          <span className="dtile w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black">{String(n).padStart(2, "0")}</span>
          <div>
            <h3 className="text-lg font-extrabold text-slate-900 tracking-tight leading-tight">{title}</h3>
            <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        {stat !== undefined && (
          <div className="text-right">
            <div className="dnum text-3xl font-black leading-none">{stat}</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-1.5">{statLabel}</div>
          </div>
        )}
      </header>
      {children}
    </section>
  );
}

function Empty({ text = "No data for this selection." }) {
  return <div className="h-48 flex items-center justify-center text-sm text-slate-500">{text}</div>;
}

/** Measured width of a container, so charts draw at real pixel size. */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(900);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => setW(Math.max(280, Math.floor(el.clientWidth)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Every k-th label so axis text never collides. */
const every = (n, w, per = 58) => Math.max(1, Math.ceil(n / Math.max(1, Math.floor(w / per))));
const GRID = "#e6ebf2";

/** 1. Columns — samples per period. */
function ComboBars({ months }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const H = 240, padL = 48, padR = 16, padT = 28, padB = 36;
  if (!months.length) return <div ref={ref}><Empty /></div>;
  const step = every(months.length, W);
  const scale = niceScale(Math.max(...months.map((m) => m.total)));
  const slot = (W - padL - padR) / months.length;
  const bw = Math.max(6, Math.min(36, slot * 0.55));
  const y = (v) => padT + (H - padT - padB) * (1 - v / scale.max);
  const cx = (i) => padL + slot * i + slot / 2;
  const base = H - padB;
  return (
    <div ref={ref} className="w-full">
      <svg width={W} height={H} role="img" aria-label="Samples per period" className="block">
        <defs>
          <linearGradient id="gCol" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6aa4f0" />
            <stop offset="100%" stopColor="#1668c1" />
          </linearGradient>
        </defs>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray="3 5" />
            <text x={padL - 10} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#94a3b8">{t}</text>
          </g>
        ))}
        {months.map((m, i) => (
          <g key={m.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.5}>
            <rect x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
            <rect x={cx(i) - bw / 2} y={y(m.total)} width={bw} height={Math.max(0, base - y(m.total))} rx={Math.min(10, bw / 2)} fill="url(#gCol)" />
            {i % step === 0 && <text x={cx(i)} y={H - 12} textAnchor="middle" fontSize="12" fill="#475569">{m.label}</text>}
          </g>
        ))}
        {hover !== null && (
          <g>
            <rect x={Math.min(W - 170, Math.max(4, cx(hover) - 80))} y="0" width="160" height="26" rx="8" fill="#0f172a" />
            <text x={Math.min(W - 90, Math.max(84, cx(hover)))} y="17" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">{months[hover].label}: {months[hover].total} samples</text>
          </g>
        )}
      </svg>
          </div>
  );
}

/** 3. Concentric progress rings — pass, fail and resequence as a share of samples. */
function RadialRings({ totals }) {
  const [hover, setHover] = useState(null);
  const sum = totals.pass + totals.fail;
  if (!sum) return <Empty />;
  const rings = [
    { k: "QC pass", v: totals.pass, of: sum, color: PASS, r: 138 },
    { k: "QC fail", v: totals.fail, of: sum, color: FAIL, r: 108 },
    { k: "Resequence", v: totals.resequence, of: Math.max(totals.total, 1), color: "#c9560f", r: 78 },
  ];
  const C = 160, SW = 20;
  const arc = (r, frac) => {
    const f = Math.min(Math.max(frac, 0.0005), 0.9995);
    const a = -Math.PI / 2 + f * Math.PI * 2;
    return `M${C},${C - r} A${r},${r} 0 ${f > 0.5 ? 1 : 0} 1 ${C + r * Math.cos(a)},${C + r * Math.sin(a)}`;
  };
  const act = hover !== null ? rings[hover] : rings[0];
  return (
    <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-14">
      <svg viewBox="0 0 320 320" width="230" height="230" role="img" aria-label="QC and resequence rates" className="shrink-0">
        {rings.map((g, i) => (
          <g key={g.k} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.4}>
            <circle cx={C} cy={C} r={g.r} fill="none" stroke="#edf1f7" strokeWidth={SW} />
            <path d={arc(g.r, g.v / g.of)} fill="none" stroke={g.color} strokeWidth={SW} strokeLinecap="round" />
          </g>
        ))}
        <text x={C} y={C + 2} textAnchor="middle" fontSize="38" fontWeight="900" fill="#0f172a">{pct(act.v, act.of)}%</text>
        <text x={C} y={C + 24} textAnchor="middle" fontSize="12" fill="#94a3b8">{act.k}</text>
      </svg>
      <ul className="space-y-5">
        {rings.map((g, i) => (
          <li key={g.k} className="flex items-center gap-4" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="w-3 h-12 rounded-full" style={{ background: g.color }} />
            <div>
              <div className="text-2xl font-black text-slate-900 leading-none">{fmt(g.v)}</div>
              <div className="text-xs font-semibold text-slate-500 mt-1">{g.k} · {pct(g.v, g.of)}% of {fmt(g.of)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 2. Packed bubbles — one circle per test type, circle area = number of samples. */
function TestBubbles({ mix, total }) {
  const [hover, setHover] = useState(null);
  const items = TEST_ORDER.map((k) => ({ k, v: mix[k] || 0 })).filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
  if (!items.length) return <Empty />;
  const maxV = items[0].v;
  const RBIG = 105, GAP = 5;
  const placed = [];
  for (const it of items) {
    const r = Math.max(20, RBIG * Math.sqrt(it.v / maxV));
    let spot = { x: 0, y: 0 };
    if (placed.length) {
      // walk outward along a spiral until the circle fits without touching another
      for (let t = 0; t < 4000; t += 1) {
        const ang = t * 0.35, dist = 4 + t * 0.35;
        const c = { x: dist * Math.cos(ang) * 1.5, y: dist * Math.sin(ang) };
        if (placed.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= p.r + r + GAP)) {
          spot = c;
          break;
        }
      }
    }
    placed.push({ ...it, r, ...spot });
  }
  const minX = Math.min(...placed.map((p) => p.x - p.r)), maxX = Math.max(...placed.map((p) => p.x + p.r));
  const minY = Math.min(...placed.map((p) => p.y - p.r)), maxY = Math.max(...placed.map((p) => p.y + p.r));
  const pad = 8;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  return (
    <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-14">
      <svg viewBox={vb} className="w-full max-w-xl shrink-0" style={{ maxHeight: 300 }} role="img" aria-label="Test type mix">
        <defs>
          {placed.map((p) => (
            <radialGradient key={p.k} id={`bb-${p.k.replace(/\W/g, "")}`} cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor={TEST_COLORS[p.k]} stopOpacity="0.75" />
              <stop offset="100%" stopColor={TEST_COLORS[p.k]} />
            </radialGradient>
          ))}
        </defs>
        {placed.map((p, i) => (
          <g key={p.k} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.4} style={{ transition: "opacity .15s" }}>
            <circle cx={p.x} cy={p.y} r={p.r + 3} fill={TEST_COLORS[p.k]} fillOpacity="0.14" />
            <circle cx={p.x} cy={p.y} r={p.r} fill={`url(#bb-${p.k.replace(/\W/g, "")})`} />
            {p.r >= 30 ? (
              <>
                <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize={Math.min(22, p.r / 2.4)} fontWeight="900" fill="#fff">{fmt(p.v)}</text>
                <text x={p.x} y={p.y + Math.min(22, p.r / 2.4) * 0.75} textAnchor="middle" fontSize={Math.min(12, p.r / 4)} fontWeight="700" fill="#fff" fillOpacity="0.9">{p.k}</text>
              </>
            ) : (
              <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">{p.k.slice(0, 3)}</text>
            )}
            <title>{`${p.k}: ${fmt(p.v)} samples (${pct(p.v, total)}%)`}</title>
          </g>
        ))}
      </svg>
      <ul className="w-full max-w-xs space-y-2.5">
        {placed.map((p, i) => (
          <li key={p.k} className="flex items-center gap-3 text-sm" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="w-3 h-3 rounded-full" style={{ background: TEST_COLORS[p.k] }} />
            <span className="font-bold text-slate-800 flex-1">{p.k}</span>
            <span className="text-slate-500 text-xs">{fmt(p.v)}</span>
            <span className="w-12 text-right font-extrabold text-slate-900">{pct(p.v, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function Analysis() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");
  const [mode, setMode] = useState("all"); // "all" | "choose"
  const [chosen, setChosen] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    api.getAnalysis().then(setData).catch((e) => setError(e.message));
  }, []);

  // One entry per (run, day): a run's samples carry their own dates, so a run can feed
  // several months. Undated samples fall back to the day the run was transferred.
  const entries = useMemo(
    () =>
      (data?.runs || []).flatMap((r) =>
        Object.entries(r.days).map(([d, v]) => {
          const date = d || r.fallback_date || "";
          return { run: r.run, date, year: date.slice(0, 4), month: date.slice(5, 7), ...v };
        })
      ),
    [data]
  );

  const periods = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (!e.year) continue;
      const k = `${e.year}-${e.month}`;
      m.set(k, { year: e.year, month: e.month, count: (m.get(k)?.count || 0) + e.total });
    }
    return [...m.values()];
  }, [entries]);

  const inPeriodEntries = useMemo(
    () => entries.filter((e) => (year === "all" || e.year === year) && (month === "all" || e.month === month)),
    [entries, year, month]
  );
  // Runs that have samples in the chosen period — what the run picker offers.
  const inPeriod = useMemo(() => [...new Set(inPeriodEntries.map((e) => e.run))].sort().map((run) => ({ run })), [inPeriodEntries]);
  const picked = useMemo(
    () => (mode === "all" ? inPeriodEntries : inPeriodEntries.filter((e) => chosen.includes(e.run))),
    [inPeriodEntries, mode, chosen]
  );

  // Per-run figures counting only the samples inside the period (for the bubbles).
  const runs = useMemo(() => {
    const m = new Map();
    for (const e of picked) {
      const cur = m.get(e.run) || { run: e.run, date: "", total: 0, pass: 0, fail: 0, resequence: 0, tests: {} };
      cur.total += e.total;
      cur.pass += e.pass;
      cur.fail += e.fail;
      cur.resequence += e.resequence;
      if (e.date > cur.date) cur.date = e.date;
      for (const [k, v] of Object.entries(e.tests)) cur.tests[k] = (cur.tests[k] || 0) + v;
      m.set(e.run, cur);
    }
    return [...m.values()];
  }, [picked]);

  const totals = useMemo(() => {
    const t = { total: 0, pass: 0, fail: 0, resequence: 0, mix: {} };
    for (const r of runs) {
      t.total += r.total;
      t.pass += r.pass;
      t.fail += r.fail;
      t.resequence += r.resequence;
      for (const [k, v] of Object.entries(r.tests)) t.mix[k] = (t.mix[k] || 0) + v;
    }
    return t;
  }, [runs]);

  // Every sample counted in the month (or day) of its own Date, across all runs.
  const months = useMemo(() => {
    const m = new Map();
    for (const e of picked) {
      if (!e.year) continue;
      const byDay = month !== "all";
      const key = byDay ? e.date : `${e.year}-${e.month}`;
      const label = byDay ? `${Number(e.date.slice(8, 10))} ${MONTHS[Number(e.month) - 1]}` : `${MONTHS[Number(e.month) - 1]} ${e.year.slice(2)}`;
      const cur = m.get(key) || { key, label, total: 0, pass: 0, fail: 0, tests: {} };
      cur.total += e.total;
      cur.pass += e.pass;
      cur.fail += e.fail;
      for (const [k, v] of Object.entries(e.tests)) cur.tests[k] = (cur.tests[k] || 0) + v;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [picked, month]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <div className="text-sm text-slate-500 py-10 text-center">Loading analysis…</div>;

  const toggle = (run) => setChosen((c) => (c.includes(run) ? c.filter((x) => x !== run) : [...c, run]));
  const label = periodLabel(year, month) || "All dates";

  const passRate = pct(totals.pass, totals.pass + totals.fail);
  const mixTotal = Object.values(totals.mix).reduce((a, b) => a + b, 0);
  const unit = month !== "all" ? "day" : "month";

  return (
    <div className="relative isolate p-4 sm:p-6 lg:p-8">
      {/* same frosted panel the Dashboard uses, so the page matches the rest of the site */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 rounded-2xl sm:rounded-3xl bg-white/80 backdrop-blur-xl ring-1 ring-white/70 shadow-[0_20px_50px_-20px_rgba(15,40,80,0.45)]"
      />

      {/* ---------- title + filters ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200/80">
        <div className="flex items-center gap-3.5">
          <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-white flex items-center justify-center shadow-md shadow-brand-700/30">
            <Icon name="activity" size={22} />
          </span>
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight leading-tight">Run Analysis</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {runs.length} run{runs.length === 1 ? "" : "s"} · {label} · approved runs only
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
            {[["all", "All runs"], ["choose", "Choose runs"]].map(([id, text]) => (
              <button
                key={id}
                onClick={() => {
                  setMode(id);
                  if (id === "choose") setPickerOpen(true);
                }}
                className={`px-3.5 py-1.5 rounded-md transition-colors ${mode === id ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {text}
                {id === "choose" && mode === "choose" ? ` (${runs.length})` : ""}
              </button>
            ))}
          </div>
          <PeriodFilter
            periods={periods}
            year={year}
            month={month}
            onChange={(p) => {
              setYear(p.year);
              setMonth(p.month);
            }}
          />
        </div>

        {mode === "choose" && (
          <div className="w-full">
            <button className="text-xs font-bold text-brand-700 hover:text-brand-900" onClick={() => setPickerOpen((o) => !o)}>
              {pickerOpen ? "Hide run list" : "Show run list"} · {chosen.filter((c) => inPeriod.some((r) => r.run === c)).length} of {inPeriod.length} selected
            </button>
            {pickerOpen && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <div className="flex gap-4 mb-2 text-xs font-bold">
                  <button className="text-brand-700 hover:underline" onClick={() => setChosen(inPeriod.map((r) => r.run))}>Select all</button>
                  <button className="text-slate-500 hover:underline" onClick={() => setChosen([])}>Clear</button>
                </div>
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                  {inPeriod.length === 0 && <span className="text-xs text-slate-400">No runs in this period.</span>}
                  {inPeriod.map((r) => {
                    const on = chosen.includes(r.run);
                    return (
                      <button
                        key={r.run}
                        onClick={() => toggle(r.run)}
                        aria-pressed={on}
                        className={`px-3 py-1 rounded-md text-xs font-bold border transition-colors ${
                          on ? "bg-brand-700 border-brand-700 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-brand-300"
                        }`}
                      >
                        {r.run}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------- charts: one by one, full width ---------- */}
      <div className="pt-2">
        <Section n={1} tone="tone-blue" title={`Samples by ${unit}`} subtitle="Samples in each period, each counted in the month of its own date" stat={fmt(totals.total)} statLabel="total samples">
          <ComboBars months={months} />
        </Section>
        <Section n={2} tone="tone-sky" title="Test type mix" subtitle="Packed bubbles · bubble area = samples of that test" stat={fmt(mixTotal)} statLabel="tested samples">
          <TestBubbles mix={totals.mix} total={mixTotal} />
        </Section>
        <Section n={3} tone="tone-green" title="QC & resequence rings" subtitle="Pass, fail and resequence as a share of samples · hover a ring" stat={`${passRate}%`} statLabel="pass rate">
          <RadialRings totals={totals} />
        </Section>
      </div>
    </div>
  );
}
