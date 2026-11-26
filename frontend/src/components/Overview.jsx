import TotalWorkDone from "./TotalWorkDone";

/**
 * The landing page for Primary Team, Primary Team Head and Bioinfo Team Head:
 * the Total Work Done totals, calculated by the backend from the approved runs.
 */
export default function Overview({ runs }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Reloads whenever the run list changes, so new uploads are picked up. */}
      <TotalWorkDone refreshKey={runs.map((r) => r.updated_at).join("|")} />
    </div>
  );
}
