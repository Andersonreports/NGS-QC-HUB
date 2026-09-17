import { Icon } from "./ui";

/** One run can rack up several notifications while you're away (each stage it
 * passed through along the way) — by the time you're looking at this, only the
 * most recent one is still true, so group by run and show just that, with a
 * count of what else happened in between instead of repeating the run. */
function groupByRun(items) {
  const byRun = new Map();
  for (const n of items) {
    const key = n.run_id || n.runNumber;
    const existing = byRun.get(key);
    if (!existing) {
      byRun.set(key, { latest: n, count: 1 });
    } else {
      existing.count += 1;
      if (new Date(n.created_at) > new Date(existing.latest.created_at)) {
        existing.latest = n;
      }
    }
  }
  return [...byRun.values()].sort((a, b) => new Date(b.latest.created_at) - new Date(a.latest.created_at));
}

/** A centered floating summary of everything unread, shown once right after
 * signing in (or reloading) — impossible to miss the way a corner toast can be,
 * and one place instead of a stack of separate banners piling up. */
function NotificationRow({ latest, count, onOpen }) {
  const isNewTransfer = latest.kind === "new_transfer";
  const isQcFail = latest.kind === "qc_fail";
  return (
    <div
      className={`px-5 py-3 ${
        isQcFail
          ? "bg-red-50 border-l-4 border-l-red-600"
          : isNewTransfer
          ? "bg-accent-50 border-l-4 border-l-accent-600"
          : ""
      }`}
    >
      {isNewTransfer && <span className="chip bg-accent-600 text-white mb-1">New transfer</span>}
      <p
        className={`text-sm ${
          isQcFail ? "font-semibold text-red-700" : isNewTransfer ? "font-semibold text-accent-900" : "text-slate-700"
        }`}
      >
        {latest.text}
      </p>
      {count > 1 && (
        <p className="text-xs text-slate-400 mt-0.5">
          +{count - 1} earlier update{count - 1 > 1 ? "s" : ""} on this run
        </p>
      )}
      {latest.runNumber && (
        <button onClick={() => onOpen(latest)} className="mt-1 text-xs font-bold text-brand-700 hover:text-brand-900">
          Open run {latest.runNumber} →
        </button>
      )}
    </div>
  );
}

export default function UnreadDigest({ items, onDismiss, onOpen }) {
  if (!items || items.length === 0) return null;
  const grouped = groupByRun(items);
  // QC fails get their own section, apart from routine updates — they're the
  // one kind of notification that shouldn't blend in with the rest.
  const qcFails = grouped.filter((g) => g.latest.kind === "qc_fail");
  const others = grouped.filter((g) => g.latest.kind !== "qc_fail");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4 fade-up">
      <div className="card w-full max-w-md shadow-2xl">
        <div className="flex items-start gap-3 p-5 pb-4 border-b border-slate-200">
          <span className="w-10 h-10 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center shrink-0">
            <Icon name="bell" size={19} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold">
              {grouped.length} run{grouped.length > 1 ? "s" : ""} updated
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Since you were last here.</p>
          </div>
          <button onClick={onDismiss} className="text-slate-400 hover:text-slate-700 shrink-0">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="max-h-[22rem] overflow-y-auto">
          {qcFails.length > 0 && (
            <div className="border-b border-slate-200">
              <div className="px-5 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-red-600">
                QC fail
              </div>
              <div className="divide-y divide-slate-100">
                {qcFails.map(({ latest, count }) => (
                  <NotificationRow key={latest.id} latest={latest} count={count} onOpen={onOpen} />
                ))}
              </div>
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {others.map(({ latest, count }) => (
              <NotificationRow key={latest.id} latest={latest} count={count} onOpen={onOpen} />
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-slate-200">
          <button className="btn-primary w-full" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
