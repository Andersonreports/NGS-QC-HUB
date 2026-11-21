import { ROLES } from "../workflow";
import TotalWorkDone from "./TotalWorkDone";

/**
 * The landing page for Primary Team, Primary Team Head and Bioinfo Team Head:
 * the Total Work Done Sample, QC and Report totals, calculated by the backend from
 * the consolidated Excel files. The soft coloured backdrop is what the glass cards
 * blur against.
 */
export default function Overview({ user, runs }) {
  const firstName = (user.full_name || "").replace(/^Dr\.?\s*/i, "").split(" ")[0];

  return (
    <div className="dash-bg space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{ROLES[user.role]?.label} · here is a summary of the work so far</p>
      </div>

      {/* Reloads whenever the run list changes, so new uploads are picked up. */}
      <TotalWorkDone refreshKey={runs.map((r) => r.updated_at).join("|")} />
    </div>
  );
}
