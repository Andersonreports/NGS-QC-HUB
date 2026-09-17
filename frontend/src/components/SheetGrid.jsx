import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, downloadSheetExport } from "../api";
import { Alert, Icon, Spinner, formatBytes, formatDateTime } from "./ui";

const QC_PASS_OPTIONS = ["Pass", "Fail"];
const RESEQ_OPTIONS = ["No", "Yes"];

function sameSelection(a, b) {
  if (!a || !b) return false;
  return a.scope === b.scope && a.row_index === b.row_index && a.column === b.column;
}

function annotationsFor(annotations, scope, row_index, column) {
  return annotations.filter(
    (a) => a.scope === scope && a.row_index === row_index && a.column === column
  );
}

function describeSelection(sel) {
  if (!sel) return "";
  if (sel.scope === "row") return `Row ${sel.row_index + 1}`;
  if (sel.scope === "column") return `Column "${sel.column}"`;
  return `Row ${sel.row_index + 1} · ${sel.column}`;
}

const ROLE_ANNOTATION_STYLE = {
  primary_team: {
    marker: "text-brand-600",
    badge: "bg-brand-100 text-brand-800",
    card: "bg-brand-50 border-brand-200",
    label: "Primary Team",
  },
  primary_head: {
    marker: "text-accent-900",
    badge: "bg-accent-300 text-accent-900",
    card: "bg-accent-200 border-accent-400",
    label: "Primary Team Head",
  },
};

function annotationStyle(annotation) {
  return ROLE_ANNOTATION_STYLE[annotation.author_role] || {
    marker: "text-slate-600", badge: "bg-slate-100 text-slate-700", card: "bg-slate-50 border-slate-200", label: annotation.author_role,
  };
}

/**
 * The consolidated Excel as a live, shared spreadsheet instead of a static preview:
 * Primary Team can edit any cell and leave notes on a cell/row/column; Primary Team
 * Head can flag a cell/row/column as an error and set QC Pass / Re-Sequencing per row.
 * Everyone who can see this run sees the same data and the same notes/flags.
 */
export default function SheetGrid({ runNumber, role, fileMeta, onDownload, onClear }) {
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);
  const [selection, setSelection] = useState(null);
  const [exporting, setExporting] = useState(false);
  // The header is always frozen. On top of that, one specific data row can be pinned
  // by its row number (as shown in the left-hand row column) — not a contiguous range
  // from the top, just that one row, so a reference row far down the sheet can stay
  // visible without dragging everything above it along too.
  const [pinnedRowNumber, setPinnedRowNumber] = useState(0);
  // Columns freeze as a contiguous run from the row-number gutter (column 0) through
  // whichever column's pin was clicked — 2 by default, matching the old fixed
  // behaviour of "row numbers + first column" always visible.
  const [freezeCols, setFreezeCols] = useState(2);
  const [switchingTab, setSwitchingTab] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setSheet(null);
    setError(null);
    setSelection(null);
    api
      .getSheet(runNumber)
      .then((d) => alive && setSheet(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [runNumber]);

  // Keep the pinned row / frozen columns in bounds if the newly-loaded sheet is
  // smaller than the previous one.
  useEffect(() => {
    if (!sheet) return;
    setPinnedRowNumber((v) => Math.min(v, sheet.rows.length + 1));
    setFreezeCols((v) => Math.min(v, sheet.columns.length + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.run_number, sheet?.columns?.length, sheet?.rows?.length]);

  async function switchTab(sheetName) {
    setSwitchingTab(true);
    setError(null);
    try {
      const updated = await api.reingestSheet(runNumber, sheetName);
      setSheet(updated);
      setSelection(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSwitchingTab(false);
    }
  }

  const hasOtherTabs = sheet?.available_sheet_names?.length > 1;

  // The filename/size row that used to belong to the wrapping preview pane's own
  // header — folded in here so the sheet's controls (freeze, notes, export…) share
  // that same row instead of needing a second toolbar strip below it.
  const header = (
    <header className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2.5 shrink-0">
      <Icon name="file" size={15} className="text-slate-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold truncate" title={fileMeta?.name}>{fileMeta?.name}</div>
        <div className="text-[11px] text-slate-400">
          {`Uploaded · run ${runNumber}`}
          {fileMeta?.size != null && ` · ${formatBytes(fileMeta.size)}`}
        </div>
      </div>

      {sheet && (
        <div className="flex items-center gap-1.5">
          <label
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 border border-slate-300 rounded-md bg-white pl-2 pr-1 py-1"
            title="Type a row number (as shown in the left-hand row column) to pin just that one row below the header while everything else scrolls normally"
          >
            Freeze row
            <input
              type="number"
              min={0}
              max={sheet.rows.length + 1}
              placeholder="e.g. 45"
              value={pinnedRowNumber || ""}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(sheet.rows.length + 1, Math.round(raw))) : 0;
                setPinnedRowNumber(clamped);
              }}
              className="w-14 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-right tabular-nums focus:outline-none focus:border-brand-500"
            />
          </label>
          {pinnedRowNumber > 0 && (
            <button
              className="btn-ghost py-1 px-2.5 text-xs"
              onClick={() => setPinnedRowNumber(0)}
              title="Stop pinning that row"
            >
              <Icon name="x" size={11} />
              Unpin row
            </button>
          )}
          {freezeCols > 0 && (
            <button
              className="btn-ghost py-1 px-2.5 text-xs"
              onClick={() => setFreezeCols(0)}
              title="Click the pin icon on a column heading to freeze up through that column"
            >
              <Icon name="x" size={11} />
              Unfreeze columns
            </button>
          )}
        </div>
      )}

      {sheet && sheet.annotations.length > 0 && (
        <button
          className={`btn-ghost py-1 px-2.5 text-xs ${notesOpen ? "bg-brand-100 text-brand-800" : ""}`}
          onClick={() => setNotesOpen((value) => !value)}
          title={notesOpen ? "Hide notes & flags" : "Show every note and flag on this sheet"}
        >
          <Icon name="info" size={12} />
          Notes &amp; flags ({sheet.annotations.length})
        </button>
      )}

      {sheet && (
        <button
          className="btn-ghost py-1 px-2.5 text-xs"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await downloadSheetExport(runNumber);
            } catch (e) {
              setError(e.message);
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? <Spinner /> : <Icon name="download" size={12} />}
          Export .xlsx
        </button>
      )}

      {onClear && (
        <button className="text-slate-400 hover:text-slate-700 shrink-0" onClick={onClear} title="Close preview">
          <Icon name="x" size={15} />
        </button>
      )}
    </header>
  );

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="p-4">
          <Alert kind="info">{error}</Alert>
        </div>
      </div>
    );
  }
  if (!sheet) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="flex-1 flex items-center justify-center py-16 text-brand-700">
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {header}

      {hasOtherTabs && (
        <div className="px-4 py-1.5 border-b border-slate-200 flex flex-wrap items-center gap-2 shrink-0 bg-white">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
            Sheet tab:
          </span>
          {sheet.available_sheet_names.map((name) => {
            const isActive = name === sheet.source_sheet_name;
            const clickable = sheet.can_edit_cells && !isActive;
            return (
              <button
                key={name}
                disabled={switchingTab || !clickable}
                onClick={() => clickable && switchTab(name)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-md disabled:opacity-60 ${
                  isActive
                    ? "bg-brand-600 text-white"
                    : clickable
                    ? "bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
                    : "bg-slate-100 text-slate-400 cursor-default"
                }`}
                title={
                  isActive
                    ? "Currently used as the consolidated data"
                    : sheet.can_edit_cells
                    ? "Use this tab as the consolidated data instead"
                    : "Only the Primary Team can switch which tab is used"
                }
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto p-3">
              <Grid
                sheet={sheet}
                selection={selection}
                onSelect={setSelection}
                pinnedRowIndex={pinnedRowNumber >= 2 ? pinnedRowNumber - 2 : null}
                freezeCols={freezeCols}
                onFreezeColThrough={(colIndex) =>
                  setFreezeCols((v) => (colIndex + 1 === v ? 0 : colIndex + 1))
                }
              />
            </div>

            <SelectionPanel
              sheet={sheet}
              role={role}
              selection={selection}
              onClose={() => setSelection(null)}
              onSheetUpdated={setSheet}
              onError={setError}
            />
          </div>

          {notesOpen && (
            <div className="w-72 shrink-0 border-l border-slate-200 flex flex-col overflow-hidden bg-white">
              <div className="px-3.5 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Notes &amp; flags ({sheet.annotations.length})
                </span>
                <button
                  className="ml-auto text-slate-400 hover:text-slate-700"
                  onClick={() => setNotesOpen(false)}
                  title="Close"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NotesAndFlagsList sheet={sheet} onJump={setSelection} onSheetUpdated={setSheet} onError={setError} />
              </div>
            </div>
          )}
      </div>
    </div>
  );
}


/**
 * The header row is always frozen. Columns freeze as a contiguous run from the
 * row-number gutter (column 0) through whichever column's pin was clicked — picked
 * per-click, not a count. Rows are different: at most one specific row (by its row
 * number, anywhere in the sheet) can be pinned directly below the header, while
 * every other row scrolls normally — there's no "everything above it" involved.
 * Offsets are measured off the real rendered cells (via refs) rather than assumed
 * from a fixed size, since column/row sizes vary with content.
 */
function Grid({ sheet, selection, onSelect, pinnedRowIndex, freezeCols, onFreezeColThrough }) {
  const canEditCells = sheet.can_edit_cells;
  const canEditQC = sheet.can_edit_qc;

  const rowNumThRef = useRef(null);
  const colThRefs = useRef([]);
  const headerRowRef = useRef(null);
  const pinnedRowRef = useRef(null);

  const [colOffsets, setColOffsets] = useState([]);
  const [rowOffsets, setRowOffsets] = useState([]);

  useLayoutEffect(() => {
    const n = Math.max(0, Math.min(freezeCols, sheet.columns.length + 1));
    const els = [rowNumThRef.current, ...colThRefs.current].slice(0, n);
    const offsets = [];
    let acc = 0;
    els.forEach((el) => {
      offsets.push(acc);
      acc += el ? el.offsetWidth : 0;
    });
    setColOffsets(offsets);
  }, [freezeCols, sheet.columns.length, sheet.rows.length]);

  useLayoutEffect(() => {
    const els = [headerRowRef.current, pinnedRowIndex != null ? pinnedRowRef.current : null];
    const offsets = [];
    let acc = 0;
    els.forEach((el) => {
      offsets.push(acc);
      acc += el ? el.offsetHeight : 0;
    });
    setRowOffsets(offsets);
  }, [pinnedRowIndex, sheet.rows.length, sheet.columns.length]);

  // rowBand: 0 = header (always frozen), 1 = the pinned row (frozen only while one is
  // set), null = an ordinary scrolling body row (never row-frozen).
  const rowFrozen = (rowBand) => rowBand === 0 || (rowBand === 1 && pinnedRowIndex != null);
  const colFrozen = (colIndex) => colIndex < freezeCols;

  function stickyStyle(rowBand, colIndex) {
    const rf = rowFrozen(rowBand);
    const cf = colFrozen(colIndex);
    if (!rf && !cf) return undefined;
    return {
      position: "sticky",
      ...(rf ? { top: rowOffsets[rowBand] ?? 0 } : {}),
      ...(cf ? { left: colOffsets[colIndex] ?? 0 } : {}),
      zIndex: rf && cf ? 30 : rf ? 20 : 10,
    };
  }

  // The QC Pass / Re-Sequencing columns sit past the last data column and are never
  // pinned to the left (freezing them there would make no sense) — only pinned to the
  // top when this row band is frozen.
  function topOnlyStickyStyle(rowBand) {
    if (!rowFrozen(rowBand)) return undefined;
    return { position: "sticky", top: rowOffsets[rowBand] ?? 0, zIndex: 20 };
  }

  const pinnedRow = pinnedRowIndex != null ? sheet.rows.find((r) => r.row_index === pinnedRowIndex) : null;
  const bodyRows = pinnedRow ? sheet.rows.filter((r) => r.row_index !== pinnedRowIndex) : sheet.rows;

  return (
    <table className="text-xs border-collapse w-full">
      <thead>
        <tr ref={headerRowRef}>
          <th
            ref={rowNumThRef}
            style={stickyStyle(0, 0)}
            className="w-10 bg-slate-100 border border-slate-200 px-1 py-1.5 text-slate-400 font-bold"
          >
            <FreezePin active={freezeCols === 1} onClick={() => onFreezeColThrough(0)} title={freezeCols === 1 ? "Unfreeze columns" : "Freeze just the row-number column"} />
          </th>
          {sheet.columns.map((col, i) => {
            const columnIndex = i + 1;
            const anns = annotationsFor(sheet.annotations, "column", null, col);
            const active = selection?.scope === "column" && selection.column === col;
            const pinned = columnIndex + 1 === freezeCols;
            return (
              <th
                key={col}
                ref={(el) => (colThRefs.current[i] = el)}
                onClick={() => onSelect({ scope: "column", row_index: null, column: col })}
                style={stickyStyle(0, columnIndex)}
                className={`border border-slate-200 px-2 py-1.5 text-left font-bold cursor-pointer whitespace-nowrap select-none ${
                  active ? "bg-brand-100 text-brand-900" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
                title="Click to view or add a note for this column"
              >
                <span className="inline-flex items-center gap-1.5">
                  <FreezePin
                    active={pinned}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFreezeColThrough(columnIndex);
                    }}
                    title={pinned ? "Unfreeze columns" : `Freeze columns up to "${col}"`}
                  />
                  {col}
                  {anns.length > 0 && <AnnotationMarkers annotations={anns} />}
                </span>
              </th>
            );
          })}
          <th
            style={topOnlyStickyStyle(0)}
            className={`border border-slate-200 px-2 py-1.5 text-left font-bold whitespace-nowrap ${
              canEditQC ? "bg-brand-50 text-brand-900" : "bg-slate-50 text-slate-500"
            }`}
          >
            QC Pass
          </th>
          <th
            style={topOnlyStickyStyle(0)}
            className={`border border-slate-200 px-2 py-1.5 text-left font-bold whitespace-nowrap ${
              canEditQC ? "bg-accent-50 text-accent-900" : "bg-slate-50 text-slate-500"
            }`}
          >
            Re-Sequencing
          </th>
        </tr>
      </thead>
      {pinnedRow && <tbody>{renderRow(pinnedRow, 1)}</tbody>}
      <tbody>{bodyRows.map((row) => renderRow(row, null))}</tbody>
    </table>
  );

  function renderRow(row, rowBand) {
    const pinned = rowBand === 1;
    const rowAnns = annotationsFor(sheet.annotations, "row", row.row_index, null);
    const rowFlagged = rowAnns.some((a) => a.kind === "flag");
    const rowNoted = rowAnns.length > 0 && !rowFlagged;
    const rowActive = selection?.scope === "row" && selection.row_index === row.row_index;
    const rowBg = rowFlagged ? "bg-accent-200/70" : rowNoted ? "bg-accent-50/50" : "";

    return (
      <tr
        key={row.row_index}
        ref={pinned ? pinnedRowRef : undefined}
        className={`${rowBg || "hover:bg-slate-50"} ${pinned ? "border-b-2 border-b-brand-300" : ""}`}
      >
        <td
          onClick={() => onSelect({ scope: "row", row_index: row.row_index, column: null })}
          style={stickyStyle(rowBand, 0)}
          className={`w-10 border border-slate-200 px-2 py-1 text-right tabular-nums cursor-pointer select-none ${
            rowActive ? "bg-brand-100 text-brand-900 font-bold" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
          }`}
          title={pinned ? "Pinned row. Click to view or add a note" : "Click to view or add a note for this row"}
        >
          <span className="inline-flex items-center gap-1">
            {pinned && <Icon name="pin" size={10} className="text-brand-700 shrink-0" />}
            {row.row_index + 2}
            {rowAnns.length > 0 && <AnnotationMarkers annotations={rowAnns} />}
          </span>
        </td>

        {sheet.columns.map((col, i) => {
          const columnIndex = i + 1;
          const cellAnns = annotationsFor(sheet.annotations, "cell", row.row_index, col);
          const active = sameSelection(selection, { scope: "cell", row_index: row.row_index, column: col });
          const frozenHere = colFrozen(columnIndex) || rowFrozen(rowBand);
          return (
            <td
              key={col}
              onClick={() => onSelect({ scope: "cell", row_index: row.row_index, column: col })}
              style={stickyStyle(rowBand, columnIndex)}
              className={`${frozenHere && !active ? "bg-white" : ""} border border-slate-200 px-2 py-1 max-w-[16rem] truncate cursor-pointer ${
                active ? "ring-2 ring-inset ring-brand-600 bg-brand-50" : ""
              }`}
              title={canEditCells ? "Click to edit or annotate" : "Click to view or annotate"}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="truncate">{row.cells[col]}</span>
                {cellAnns.length > 0 && <AnnotationMarkers annotations={cellAnns} />}
              </span>
            </td>
          );
        })}

        <td
          style={topOnlyStickyStyle(rowBand)}
          className={`border border-slate-200 px-2 py-1 ${rowFrozen(rowBand) ? "bg-white" : ""} ${canEditQC ? "bg-brand-50/40" : ""}`}
        >
          <QCBadgeOrSelect
            value={row.qc_pass}
            options={QC_PASS_OPTIONS}
            editable={canEditQC}
            tone={row.qc_pass === "Fail" ? "red" : "green"}
            onChange={(value) => onSelect({ scope: "row", row_index: row.row_index, column: null, __qc: { qc_pass: value } })}
          />
        </td>
        <td
          style={topOnlyStickyStyle(rowBand)}
          className={`border border-slate-200 px-2 py-1 ${rowFrozen(rowBand) ? "bg-white" : ""} ${canEditQC ? "bg-accent-50/40" : ""}`}
        >
          <QCBadgeOrSelect
            value={row.resequencing}
            options={RESEQ_OPTIONS}
            editable={canEditQC}
            tone={row.resequencing === "Yes" ? "amber" : "slate"}
            onChange={(value) => onSelect({ scope: "row", row_index: row.row_index, column: null, __qc: { resequencing: value } })}
          />
        </td>
      </tr>
    );
  }
}

/** The small pin button on a column heading that freezes the grid up through that
 * column — clicking the already-pinned column's icon unfreezes columns entirely. */
function FreezePin({ active, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`shrink-0 w-4 h-4 flex items-center justify-center rounded-sm ${
        active ? "text-brand-700" : "text-slate-400 hover:text-brand-600"
      }`}
    >
      <Icon name="pin" size={12} strokeWidth={active ? 2.6 : 2.2} />
    </button>
  );
}

function AnnotationMarkers({ annotations }) {
  const markers = annotations.filter(
    (annotation, index) =>
      annotations.findIndex((item) => item.kind === annotation.kind && item.author_role === annotation.author_role) === index
  );
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0" aria-label={`${annotations.length} annotation${annotations.length > 1 ? "s" : ""}`}>
      {markers.map((annotation) => {
        const style = annotationStyle(annotation);
        return (
          <span
            key={`${annotation.kind}-${annotation.author_role}`}
            className={`font-bold leading-none ${style.marker}`}
            title={`${annotation.kind === "flag" ? "Flag" : "Note"} from ${style.label}`}
          >
            {annotation.kind === "flag" ? "⚑" : "✎"}
          </span>
        );
      })}
    </span>
  );
}

function QCBadgeOrSelect({ value, options, editable, tone, onChange }) {
  const tones = {
    green: "bg-brand-100 text-brand-800",
    red: "bg-accent-300 text-accent-900",
    amber: "bg-accent-100 text-accent-800",
    slate: "bg-slate-100 text-slate-600",
  };
  if (!editable) {
    return <span className={`chip ${tones[tone]}`}>{value}</span>;
  }
  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs font-bold rounded-md px-1.5 py-1 border-0 cursor-pointer ${tones[tone]}`}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** The panel that opens when a cell / row / column is clicked: edit the value (Primary
 * Team, cells only), see existing notes/flags for exactly that target, and add a new
 * one. Also carries QC Pass / Re-Sequencing changes fired from the grid's dropdowns. */
function SelectionPanel({ sheet, role, selection, onClose, onSheetUpdated, onError }) {
  const [draftValue, setDraftValue] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [busy, setBusy] = useState(false);

  const qcChange = selection?.__qc;

  useEffect(() => {
    if (qcChange) {
      setBusy(true);
      api
        .editSheetQC(sheet.run_number, { row_index: selection.row_index, ...qcChange })
        .then((updated) => onSheetUpdated(updated))
        .catch((e) => onError(e.message))
        .finally(() => setBusy(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    if (selection?.scope === "cell") {
      const row = sheet.rows.find((r) => r.row_index === selection.row_index);
      setDraftValue(row?.cells[selection.column] ?? "");
    }
    setDraftNote("");
  }, [selection, sheet]);

  if (!selection || qcChange) return null;

  const row = selection.row_index != null ? sheet.rows.find((r) => r.row_index === selection.row_index) : null;
  const canEditThisCell = selection.scope === "cell" && sheet.can_edit_cells;
  const cellChanged = canEditThisCell && draftValue !== (row?.cells[selection.column] ?? "");

  async function saveValue() {
    setBusy(true);
    try {
      const updated = await api.editSheetCell(sheet.run_number, {
        row_index: selection.row_index, column: selection.column, value: draftValue,
      });
      onSheetUpdated(updated);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitAnnotation() {
    if (!draftNote.trim()) return;
    setBusy(true);
    try {
      const updated = await api.addSheetAnnotation(sheet.run_number, {
        scope: selection.scope, row_index: selection.row_index, column: selection.column, text: draftNote.trim(),
      });
      onSheetUpdated(updated);
      setDraftNote("");
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50/60 p-3.5 shrink-0 max-h-72 overflow-y-auto">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs font-bold text-slate-700">{describeSelection(selection)}</span>
        <button className="ml-auto text-slate-400 hover:text-slate-700" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>

      {selection.scope === "cell" && (
        <div className="flex items-center gap-2 mb-3">
          <input
            className="field flex-1 text-xs py-1.5"
            value={draftValue}
            disabled={!canEditThisCell}
            onChange={(e) => setDraftValue(e.target.value)}
            placeholder={canEditThisCell ? "Cell value" : "Only the Primary Team can edit values"}
          />
          {canEditThisCell && (
            <button className="btn-primary py-1.5 px-3 text-xs" disabled={!cellChanged || busy} onClick={saveValue}>
              {busy ? <Spinner /> : <Icon name="check" size={13} />}
              Save
            </button>
          )}
        </div>
      )}

      {sheet.can_annotate && (
        <div className="flex items-start gap-2">
          <textarea
            className="field text-xs flex-1"
            rows={2}
            placeholder={role === "primary_head" ? "Describe the error…" : "Add a note…"}
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
          />
          <button
            className={role === "primary_head" ? "btn-danger py-1.5 px-3 text-xs shrink-0" : "btn-primary py-1.5 px-3 text-xs shrink-0"}
            disabled={busy || !draftNote.trim()}
            onClick={submitAnnotation}
          >
            {busy ? <Spinner /> : <Icon name={role === "primary_head" ? "x" : "check"} size={13} />}
            {role === "primary_head" ? "Add flag" : "Add note"}
          </button>
        </div>
      )}
    </div>
  );
}

function NotesAndFlagsList({ sheet, onJump, onSheetUpdated, onError }) {
  const [deletingId, setDeletingId] = useState(null);
  const sorted = [...sheet.annotations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  async function handleDelete(e, annotationId) {
    e.stopPropagation();
    setDeletingId(annotationId);
    try {
      const updated = await api.deleteSheetAnnotation(sheet.run_number, annotationId);
      onSheetUpdated(updated);
    } catch (err) {
      onError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <ul className="divide-y divide-slate-100">
      {sorted.map((a) => {
        const style = annotationStyle(a);
        const row = a.row_index != null ? sheet.rows.find((r) => r.row_index === a.row_index) : null;
        const value = a.scope === "cell" && row ? row.cells[a.column] : null;
        return (
          <li key={a.id}>
            <button
              className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-start gap-2"
              onClick={() => onJump({ scope: a.scope, row_index: a.row_index, column: a.column })}
            >
              <span
                className={`mt-0.5 shrink-0 text-sm leading-none ${style.marker}`}
                title={a.kind === "flag" ? "Flag" : "Note"}
              >
                {a.kind === "flag" ? "⚑" : "✎"}
              </span>
              <span className="flex-1 min-w-0 space-y-1">
                <span className="block text-xs font-semibold text-slate-700">
                  {describeSelection({ scope: a.scope, row_index: a.row_index, column: a.column })}
                </span>
                {value != null && value !== "" && (
                  <span className="block text-xs text-slate-600">
                    <span className="text-slate-400">Value: </span>
                    {value}
                  </span>
                )}
                <span className="block text-xs text-slate-800">{a.text}</span>
                <span className="block text-[11px] text-slate-400">
                  Marked by {a.author_name} ({style.label}) ·{" "}
                  <span className="font-bold text-black">{formatDateTime(a.created_at)}</span>
                </span>
              </span>
              {a.can_delete && (
                <span
                  role="button"
                  onClick={(e) => handleDelete(e, a.id)}
                  title={`Remove this ${a.kind}`}
                  className="shrink-0 text-slate-400 hover:text-accent-900"
                >
                  {deletingId === a.id ? <Spinner /> : <Icon name="x" size={14} />}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
