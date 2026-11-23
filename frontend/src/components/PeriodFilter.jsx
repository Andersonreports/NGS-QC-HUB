import { useEffect, useState } from "react";
import { Icon } from "./ui";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "April 2026", "April (all years)" or "2026" for a chosen year / month ("all" = none). */
export function periodLabel(year, month) {
  const y = year && year !== "all" ? year : null;
  const m = month && month !== "all" ? MONTH_NAMES[Number(month) - 1] : null;
  if (m && y) return `${m} ${y}`;
  if (m) return `${m} (all years)`;
  return y || "";
}

/** Dropdown options from a list of { year, month, count }: the years present, and the
 * months present within the chosen year (or across every year when none is chosen). */
export function periodOptions(periods, year) {
  const years = new Map();
  for (const p of periods) years.set(p.year, (years.get(p.year) || 0) + p.count);
  const months = new Map();
  for (const p of periods) {
    if (year !== "all" && p.year !== year) continue;
    months.set(p.month, (months.get(p.month) || 0) + p.count);
  }
  return {
    years: [...years].sort((a, b) => b[0].localeCompare(a[0])).map(([value, count]) => ({ value, count })),
    months: [...months]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count, label: MONTH_NAMES[Number(value) - 1] || value })),
  };
}

const SELECT =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 " +
  "focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:opacity-50";

/**
 * A compact date filter: one button showing the active period ("All dates" or
 * "October 2026"), opening a small panel with Year and Month dropdowns over the dates
 * that actually exist. `periods` is [{ year, month, count }]; `year` / `month` are
 * "all" or a value from the options. Picking a different year resets the month, since
 * months are listed per year.
 */
export default function PeriodFilter({ periods, year, month, onChange, className = "" }) {
  const [open, setOpen] = useState(false);
  const { years, months } = periodOptions(periods, year);
  const active = year !== "all" || month !== "all";

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`btn bg-white py-2 px-3.5 text-xs border ${
          active ? "border-brand-300 text-brand-800 bg-brand-50" : "border-slate-200 text-slate-700 hover:bg-slate-50"
        }`}
      >
        <Icon name="calendar" size={14} />
        {active ? periodLabel(year, month) : "All dates"}
        <Icon name="chevronDown" size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Filter by date" className="absolute right-0 mt-2 w-72 card shadow-lg z-20 p-4 space-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Filter by date</div>
              <div className="text-xs text-slate-500 mt-0.5">Uses each sample's Date</div>
            </div>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-600 mb-1">Year</span>
              <select className={SELECT} value={year} onChange={(e) => onChange({ year: e.target.value, month: "all" })}>
                <option value="all">All years</option>
                {years.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value} ({o.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-600 mb-1">Month</span>
              <select
                className={SELECT}
                value={month}
                disabled={months.length === 0}
                onChange={(e) => onChange({ year, month: e.target.value })}
              >
                <option value="all">All months</option>
                {months.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} ({o.count})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                disabled={!active}
                className="text-xs font-semibold text-brand-700 hover:text-brand-900 disabled:text-slate-300 disabled:cursor-default"
                onClick={() => onChange({ year: "all", month: "all" })}
              >
                Clear filter
              </button>
              <button type="button" className="btn-primary py-1.5 px-3.5 text-xs" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
