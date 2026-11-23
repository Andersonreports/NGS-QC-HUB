import TotalWorkDone from "./TotalWorkDone";

/**
 * The landing page for Primary Team, Primary Team Head and Bioinfo Team Head:
 * the Total Work Done totals, calculated by the backend from the approved runs.
 */
export default function Overview({ runs }) {
  // Reloads whenever the run list changes, so new uploads are picked up.
  return <TotalWorkDone refreshKey={runs.map((r) => r.updated_at).join("|")} />;
}
