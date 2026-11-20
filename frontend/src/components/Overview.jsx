import { useMemo } from "react";
import { ROLES, STAGES, STAGE_BY_ID, isAwaiting, runState } from "../workflow";
import { Icon, daysSince, timeAgo } from "./ui";

// Matches the reminder threshold used for "days since transfer" elsewhere.
const STALE_DAYS = 5;
const MONTHS_SHOWN = 6;

// Passive/Wet-Lab-only checkpoints a run passes through instantly on creation —
// not useful as pipeline columns. Runs land directly on "drive_checked".
const PIPELINE_STAGES = STAGES.filter(
  (s) => !["raw_data_placed", "dashboard_updated", "notified"].includes(s.id)
);

/**
 * The landing page for Primary Team, Primary Team Head and Bioinfo Team Head:
 * a glanceable summary of every run — headline counts, where runs are sitting in
 * the pipeline, what needs attention, recent activity and monthly throughput.
 * Everything is derived from the runs list already loaded by App, so it adds no
 * extra requests and refreshes with the same 10s poll.
 */
export default function Overview({ user, runs, onViewRun, onOpenWork }) {
  const data = useMemo(() => {
    const active = runs.filter((r) => r.status === "in_progress");
    const completed = runs.filter((r) => r.status === "completed");
    const mine = runs.filter((r) => isAwaiting(r, user.role));
    const needsReupload = runs.filter((r) => runState(r).key === "needs_reupload");
    const stale = active.filter((r) => daysSince(r.created_at) >= STALE_DAYS);
    const resequencing = runs.filter((r) => r.has_resequencing);

    const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.id, 0]));
    active.forEach((r) => {
      if (r.current_stage in byStage) byStage[r.current_stage] += 1;
    });

    // Transfers per calendar month (a run's created_at), oldest → newest.
    const now = new Date();
    const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1 - i), 1);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: "short" }), total: 0, done: 0 };
    });
    const monthByKey = Object.fromEntries(months.map((m) => [m.key, m]));
    runs.forEach((r) => {
      const d = new Date(r.created_at.endsWith("Z") || r.created_at.includes("+") ? r.created_at : r.created_at + "Z");
      const m = monthByKey[`${d.getFullYear()}-${d.getMonth()}`];
      if (!m) return;
      m.total += 1;
      if (r.status === "completed") m.done += 1;
    });

    // "Needs attention", most urgent first, each run listed once with its reasons.
    const attention = new Map();
    const flag = (run, reason, weight) => {
      const e = attention.get(run.id) || { run, reasons: [], weight: 0 };
      e.reasons.push(reason);
      e.weight += weight;
      attention.set(run.id, e);
    };
    needsReupload.forEach((r) => flag(r, "Needs re-upload", 4));
    mine.forEach((r) => flag(r, "Waiting on you", 3));
    stale.forEach((r) => flag(r, `${daysSince(r.created_at)}d since transfer`, 2));
    active.filter((r) => r.has_resequencing).forEach((r) => flag(r, "Re-sequencing", 1));
    const attentionList = [...attention.values()].sort(
      (a, b) => b.weight - a.weight || new Date(a.run.updated_at) - new Date(b.run.updated_at)
    );

    const recent = [...runs].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 8);

    return { active, completed, mine, needsReupload, stale, resequencing, byStage, months, attentionList, recent };
  }, [runs, user.role]);

  const completionRate = runs.length ? Math.round((data.completed.length / runs.length) * 100) : 0;
  const firstName = (user.full_name || "").replace(/^Dr\.?\s*/i, "").split(" ")[0];

  const tiles = [
    { label: "Total runs", value: runs.length, icon: "flask", tone: "text-slate-900", hint: `${completionRate}% completed` },
    { label: "In progress", value: data.active.length, icon: "refresh", tone: "text-brand-700", hint: "moving through approvals" },
    { label: "Waiting on you", value: data.mine.length, icon: "clock", tone: data.mine.length ? "text-accent-600" : "text-slate-900", hint: ROLES[user.role]?.label, onClick: onOpenWork },
    { label: "Needs re-upload", value: data.needsReupload.length, icon: "alertTriangle", tone: data.needsReupload.length ? "text-red-600" : "text-slate-900", hint: "sent back by a reviewer" },
    { label: "Overdue", value: data.stale.length, icon: "hourglass", tone: data.stale.length ? "text-accent-600" : "text-slate-900", hint: `open ${STALE_DAYS}+ days` },
    { label: "Completed", value: data.completed.length, icon: "check", tone: "text-brand-700", hint: "handed to tertiary" },
  ];

  const maxStage = Math.max(1, ...Object.values(data.byStage));
  const maxMonth = Math.max(1, ...data.months.map((m) => m.total));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {data.mine.length > 0
            ? `${data.mine.length} run${data.mine.length === 1 ? " is" : "s are"} waiting on ${ROLES[user.role]?.label}.`
            : "Nothing is waiting on you right now."}{" "}
          Here is where every run stands.
        </p>
      </div>

      {/* ---- headline counts ---- */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map((t) => {
          const Tag = t.onClick ? "button" : "div";
          return (
            <Tag
              key={t.label}
              onClick={t.onClick}
              className={`card p-4 text-left ${t.onClick ? "hover:border-slate-300 transition" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.label}</span>
                <Icon name={t.icon} size={14} className="text-slate-300" />
              </div>
              <div className={`text-3xl font-extrabold mt-1.5 ${t.tone}`}>{t.value}</div>
              <div className="text-xs text-slate-400 mt-0.5 truncate">{t.hint}</div>
            </Tag>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
        {/* ---- pipeline ---- */}
        <section className="card p-5">
          <h2 className="text-base font-bold">Pipeline</h2>
          <p className="text-sm text-slate-500 mt-0.5">Open runs by the step they are currently at.</p>
          <ul className="mt-4 space-y-2.5">
            {PIPELINE_STAGES.filter((s) => s.id !== "completed").map((s) => {
              const count = data.byStage[s.id];
              const role = ROLES[s.role];
              return (
                <li key={s.id} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_2rem] sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_2rem] gap-3 items-center">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.title}</div>
                    <div className="text-xs font-semibold" style={{ color: role?.color }}>
                      {role?.label}
                    </div>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${(count / maxStage) * 100}%`, background: role?.color }}
                    />
                  </div>
                  <span className={`text-sm font-bold text-right ${count ? "" : "text-slate-300"}`}>{count}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---- needs attention ---- */}
        <section className="card overflow-hidden flex flex-col">
          <header className="p-5 pb-3">
            <h2 className="text-base font-bold">Needs attention</h2>
            <p className="text-sm text-slate-500 mt-0.5">Send-backs, runs waiting on you and anything overdue.</p>
          </header>
          {data.attentionList.length === 0 ? (
            <div className="px-5 pb-8 pt-3 text-center">
              <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-2">
                <Icon name="check" size={20} />
              </div>
              <p className="text-sm font-semibold text-slate-600">All clear</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 border-t border-slate-200 max-h-[22rem] overflow-y-auto">
              {data.attentionList.map(({ run, reasons }) => (
                <RunLine key={run.id} run={run} onViewRun={onViewRun}>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {reasons.map((r) => (
                      <span key={r} className="chip bg-accent-100 text-accent-800">
                        {r}
                      </span>
                    ))}
                  </div>
                </RunLine>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
        {/* ---- monthly throughput ---- */}
        <section className="card p-5">
          <h2 className="text-base font-bold">Monthly transfers</h2>
          <p className="text-sm text-slate-500 mt-0.5">Runs transferred per month, and how many are completed.</p>
          <div className="mt-5 flex items-end gap-3 h-40">
            {data.months.map((m) => (
              <div key={m.key} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5 min-w-0">
                <span className="text-xs font-bold text-slate-600">{m.total || ""}</span>
                <div
                  className="w-full max-w-[3rem] rounded-t-md bg-brand-100 relative overflow-hidden"
                  style={{ height: `${(m.total / maxMonth) * 100}%`, minHeight: m.total ? "4px" : "2px" }}
                  title={`${m.total} transferred · ${m.done} completed`}
                >
                  <div className="absolute bottom-0 inset-x-0 bg-brand-600" style={{ height: m.total ? `${(m.done / m.total) * 100}%` : 0 }} />
                </div>
                <span className="text-xs text-slate-500">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-brand-600" /> Completed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-brand-100" /> Still open
            </span>
          </div>
        </section>

        {/* ---- recent activity ---- */}
        <section className="card overflow-hidden">
          <header className="p-5 pb-3">
            <h2 className="text-base font-bold">Recent activity</h2>
            <p className="text-sm text-slate-500 mt-0.5">The runs updated most recently.</p>
          </header>
          {data.recent.length === 0 ? (
            <p className="px-5 pb-8 pt-3 text-center text-sm text-slate-500">No runs yet.</p>
          ) : (
            <ul className="divide-y divide-slate-200 border-t border-slate-200">
              {data.recent.map((run) => (
                <RunLine key={run.id} run={run} onViewRun={onViewRun} showTime />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function RunLine({ run, onViewRun, showTime, children }) {
  const stage = STAGE_BY_ID[run.current_stage];
  const state = runState(run);
  return (
    <li>
      <button
        onClick={() => onViewRun(run.run_number)}
        className="w-full text-left px-5 py-3 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none flex items-center gap-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm">{run.run_number}</span>
            <span className={`chip ${state.chip}`}>{state.label}</span>
          </div>
          <div className="text-xs text-slate-500 truncate mt-0.5">{stage?.title}</div>
          {children}
        </div>
        {showTime && <span className="text-xs text-slate-400 shrink-0">{timeAgo(run.updated_at)}</span>}
        <Icon name="chevronRight" size={15} className="text-slate-300 shrink-0" />
      </button>
    </li>
  );
}
