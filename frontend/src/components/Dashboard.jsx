import { useMemo, useState } from "react";
import { ROLES, STAGE_BY_ID, isAwaiting, runState, stageLabelFor } from "../workflow";
import { Icon, timeAgo } from "./ui";

/**
 * How many runs exist and where they stand, then every run as a clickable list.
 * Sits below whatever the signed-in role actually has to do.
 */
export default function Dashboard({ user, runs, onViewRun }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const stats = useMemo(() => {
    const byState = { in_progress: 0, needs_reupload: 0, reuploaded: 0, completed: 0 };
    runs.forEach((r) => {
      byState[runState(r).key] += 1;
    });
    return {
      total: runs.length,
      active: runs.filter((r) => r.status === "in_progress").length,
      completed: byState.completed,
      mine: runs.filter((r) => isAwaiting(r, user.role)).length,
      needsReupload: byState.needs_reupload,
      reuploaded: byState.reuploaded,
      resequencing: runs.filter((r) => r.has_resequencing).length,
    };
  }, [runs, user.role]);

  const tiles = [
    { id: "all", label: "Total runs", value: stats.total, tone: "text-slate-900", icon: "flask" },
    { id: "active", label: "In progress", value: stats.active, tone: "text-brand-700", icon: "refresh" },
    { id: "mine", label: "Action required", value: stats.mine, tone: "text-accent-600", icon: "users" },
    { id: "completed", label: "Completed", value: stats.completed, tone: "text-brand-700", icon: "check" },
  ];

  // Kept out of the count tiles since they're edge cases rather than everyday counts —
  // available instead as filters alongside the date range.
  const secondaryFilters = [
    { id: "needs_reupload", label: "Needs re-upload", count: stats.needsReupload },
    { id: "resequencing", label: "Needs re-sequencing", count: stats.resequencing },
  ];
  const FILTER_LABELS = { ...Object.fromEntries(tiles.map((t) => [t.id, t.label])), ...Object.fromEntries(secondaryFilters.map((f) => [f.id, f.label])) };

  // Date range filters on the transfer date (a run's created_at — the same "raw data
  // transferred" date used for the 5-day reminder), so "runs transferred this week"
  // means what people expect it to mean.
  const fromTime = dateFrom ? new Date(dateFrom + "T00:00:00").getTime() : null;
  const toTime = dateTo ? new Date(dateTo + "T23:59:59.999").getTime() : null;
  const dateFilterActive = Boolean(dateFrom || dateTo);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((r) => {
      if (q && !r.run_number.toLowerCase().includes(q)) return false;
      if (fromTime != null && new Date(r.created_at).getTime() < fromTime) return false;
      if (toTime != null && new Date(r.created_at).getTime() > toTime) return false;
      if (filter === "all") return true;
      if (filter === "active") return r.status === "in_progress";
      if (filter === "mine") return isAwaiting(r, user.role);
      if (filter === "resequencing") return r.has_resequencing;
      return runState(r).key === filter;
    });
  }, [runs, filter, query, user.role, fromTime, toTime]);

  return (
    <div className="flex flex-col gap-4 lg:h-full">
      {/* ---- counts ---- */}
      <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`card p-4 text-left transition ${
              filter === t.id ? "ring-2 ring-brand-600 border-brand-300" : "hover:border-slate-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.label}</span>
              <Icon name={t.icon} size={14} className="text-slate-300" />
            </div>
            <div className={`text-3xl font-extrabold mt-1.5 ${t.tone}`}>{t.value}</div>
          </button>
        ))}
      </div>

      {/* ---- every run ---- */}
      <section className="card overflow-hidden flex flex-col flex-1 lg:min-h-0">
        <header className="p-5 pb-4 flex flex-wrap items-center gap-3 border-b border-slate-200 shrink-0">
          <div className="flex-1 min-w-[12rem]">
            <h2 className="text-base font-bold">
              {filter === "all" ? "All runs" : `Runs: ${FILTER_LABELS[filter] ?? filter}`}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {visible.length} of {runs.length} run{runs.length === 1 ? "" : "s"} · click a run to see its files
              and history
            </p>
          </div>
          {(filter !== "all" || dateFilterActive) && (
            <button
              className="btn-ghost py-1.5 px-3 text-xs"
              onClick={() => {
                setFilter("all");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear filters
            </button>
          )}
          <div className="relative w-full sm:w-60">
            <Icon name="search" size={15} className="absolute left-3 top-3 text-slate-400" />
            <input
              className="field pl-9"
              placeholder="Search run number…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </header>

        <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-2 bg-slate-50/60 shrink-0">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Transferred</span>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            From
            <input
              type="date"
              className="field py-1 px-2 text-xs w-auto"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            To
            <input
              type="date"
              className="field py-1 px-2 text-xs w-auto"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          {dateFilterActive && (
            <button
              className="text-xs font-semibold text-brand-700 hover:text-brand-900"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear dates
            </button>
          )}

          <span className="w-px h-4 bg-slate-300 hidden sm:block" />

          {secondaryFilters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(filter === f.id ? "all" : f.id)}
              className={`chip transition ${
                filter === f.id
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-slate-300 text-slate-600 hover:border-slate-400"
              }`}
            >
              {f.label} · {f.count}
            </button>
          ))}
        </div>

        {runs.length === 0 ? (
          <EmptyRuns role={user.role} />
        ) : visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No runs match that.</p>
        ) : (
          <ul className="divide-y divide-slate-200 max-h-[36rem] overflow-y-auto lg:max-h-none lg:flex-1 lg:min-h-0">
            {visible.map((run) => (
              <RunRow key={run.id} run={run} user={user} onViewRun={onViewRun} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunRow({ run, user, onViewRun }) {
  const stage = STAGE_BY_ID[run.current_stage];
  const mine = isAwaiting(run, user.role);
  // A generic "in progress" is upgraded to "Action required" when it's sitting
  // with this user's own team, instead of showing both at once.
  const state =
    mine && runState(run).key === "in_progress"
      ? { key: "action_required", label: "Action required", urgent: true }
      : runState(run);

  return (
    <li>
      <button
        onClick={() => onViewRun(run.run_number)}
        className="w-full text-left px-5 py-3.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
      >
        <div className="grid grid-cols-[5.5rem_1.75rem_minmax(0,1fr)_6rem_3rem_4.5rem_1rem] gap-3 items-center">
          <span className="font-mono font-bold text-sm truncate">{run.run_number}</span>
          <StatusIcon state={state} />

          <span className="text-sm text-slate-600 truncate">{stageLabelFor(run, user.role)}</span>

          <span className="text-xs text-slate-500 truncate">{stage.role ? ROLES[stage.role]?.label : ""}</span>

          <span className="text-xs text-slate-500 flex items-center gap-1.5 justify-end">
            <Icon name="file" size={13} className="text-slate-400" />
            {run.file_count}
          </span>
          <span className="text-xs text-slate-400 text-right">{timeAgo(run.updated_at)}</span>
          <Icon name="chevronRight" size={15} className="text-slate-300 shrink-0 justify-self-end" />
        </div>
      </button>
    </li>
  );
}

/** A symbol instead of a word: a green check for done, an hourglass for moving
 * normally, a notepad-and-pen for back in review, a red alert triangle for the
 * one state that needs attention. The full word is still there as a native
 * tooltip on hover. */
function StatusIcon({ state }) {
  if (state.key === "completed") {
    return (
      <span
        className="w-[1.15rem] h-[1.15rem] rounded-full bg-green-600 text-white flex items-center justify-center shrink-0"
        title={state.label}
      >
        <Icon name="check" size={11} strokeWidth={3.2} />
      </span>
    );
  }
  if (state.urgent) {
    return (
      <span className="text-red-600 shrink-0 flex items-center" title={state.label}>
        <Icon name="alertTriangle" size={18} strokeWidth={2.2} />
      </span>
    );
  }
  if (state.key === "reuploaded") {
    return (
      <span className="text-brand-600 shrink-0 flex items-center" title={state.label}>
        <Icon name="notepadPen" size={16} strokeWidth={2} />
      </span>
    );
  }
  return (
    <span className="text-brand-600 shrink-0 flex items-center" title={state.label}>
      <Icon name="hourglass" size={16} strokeWidth={2} />
    </span>
  );
}

function EmptyRuns({ role }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
        <Icon name="flask" size={24} />
      </div>
      <p className="text-sm font-semibold text-slate-600">No runs yet</p>
      <p className="text-sm text-slate-400 mt-1">
        {role === "wetlab"
          ? "Record a raw data transfer above to start the first run."
          : "Runs appear here once Wet Lab marks a raw data transfer as complete."}
      </p>
    </div>
  );
}
