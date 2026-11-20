import TotalWorkDone from "./TotalWorkDone";

/**
 * The landing page for Primary Team, Primary Team Head and Bioinfo Team Head:
 * the Total Work Done Sample and QC totals, calculated by the backend from the
 * consolidated Excel files.
 */
export default function Overview({ user, runs }) {
  const firstName = (user.full_name || "").replace(/^Dr\.?\s*/i, "").split(" ")[0];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold">Welcome back{firstName ? `, ${firstName}` : ""}</h1>

      {/* Reloads whenever the run list changes, so new uploads are picked up. */}
      <TotalWorkDone refreshKey={runs.map((r) => r.updated_at).join("|")} />
    </div>
  );
}
