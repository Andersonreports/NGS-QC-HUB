import { useState } from "react";
import { Alert } from "./ui";

const MAX_PREVIEW_ROWS = 300;

/**
 * Parses a workbook blob into `[{ name, rows }]` exactly as it's laid out in the file —
 * no assumption about which row is a header, no reshaping. Used both for the plain
 * read-only preview (raw CSV/Excel) and as the "view original file" fallback inside the
 * editable consolidated-Excel grid, so there's always a faithful view of the real file
 * no matter how unusual its layout is (multi-row headers, transposed metrics tables,
 * merged title cells, etc. — real lab QC exports are often not a simple one-row-header
 * table).
 */
export async function parseWorkbookBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: "", raw: false }),
  }));
}

/** Renders parsed sheets as-is: every row shown plainly, first row included, no
 * "these are column headers" assumption — because that assumption is exactly what
 * breaks on real-world multi-header / transposed lab exports. */
export default function RawSheetTable({ sheets }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[active];

  if (!sheet || sheet.rows.length === 0) {
    return (
      <div className="h-full overflow-auto p-4">
        <Alert kind="info">This file has no rows to show.</Alert>
      </div>
    );
  }

  const shown = sheet.rows.slice(0, MAX_PREVIEW_ROWS);
  const colCount = Math.max(0, ...shown.map((r) => r.length));

  return (
    // h-full + flex-col so the table's own scroll region below is height-bounded —
    // otherwise its horizontal scrollbar ends up below the last row instead of
    // staying inside the visible preview area.
    <div className="h-full flex flex-col">
      {sheets.length > 1 && (
        <div className="flex gap-1 px-3 pt-3 flex-wrap shrink-0">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActive(i)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-md ${
                i === active ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        <table className="text-xs border-collapse">
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className="hover:bg-slate-50">
                <td className="sticky left-0 bg-slate-100 border border-slate-200 px-2 py-1 text-slate-400 text-right tabular-nums">
                  {r + 1}
                </td>
                {Array.from({ length: colCount }).map((_, c) => (
                  <td
                    key={c}
                    className="border border-slate-200 px-2 py-1 whitespace-nowrap max-w-[16rem] truncate"
                    title={String(row[c] ?? "")}
                  >
                    {String(row[c] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100 shrink-0">
        {sheet.rows.length > MAX_PREVIEW_ROWS
          ? `Showing first ${MAX_PREVIEW_ROWS} of ${sheet.rows.length} rows, exactly as they appear in the file.`
          : `${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"}, exactly as they appear in the file.`}
      </p>
    </div>
  );
}
