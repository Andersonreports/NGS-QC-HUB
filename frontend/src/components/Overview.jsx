import TotalWorkDone from "./TotalWorkDone";

/**
 * The landing page for Primary Team, Primary Team Head and Bioinfo Team Head:
 * the Total Work Done totals, calculated by the backend from the approved runs.
 *
 * The page has a photographic background, so the content sits on one frosted-glass
 * panel: the photo still shows around and faintly through it, but headings, labels and
 * cards always have a calm, light surface to be read against.
 *
 * The blur lives on its own background layer, not on the wrapper: a backdrop-filter on
 * an ancestor would make the dialogs and menus below (which are `position: fixed`) size
 * themselves to this panel instead of the whole window.
 */
export default function Overview({ runs }) {
  return (
    <div className="relative isolate p-4 sm:p-6 lg:p-8">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 rounded-2xl sm:rounded-3xl bg-white/75 backdrop-blur-xl ring-1 ring-white/70 shadow-[0_20px_50px_-20px_rgba(15,40,80,0.45)]"
      />
      {/* Reloads whenever the run list changes, so new uploads are picked up. */}
      <TotalWorkDone refreshKey={runs.map((r) => r.updated_at).join("|")} />
    </div>
  );
}
