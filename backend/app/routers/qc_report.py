"""QC Report — pick runs, pick the sample-level columns from inside those runs
(Sample_ID, Gen_ID, Test, QC status, ...) and download them as a PDF, one section per run.

Restricted to the two team-head roles (an admin acting as one of them passes too, via
the same stand-in user `require_role` already sees). Enforced here on every endpoint,
not just hidden in the UI.
"""
import json
import re
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from fpdf import FPDF
from fpdf.fonts import FontFace
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..deps import require_role
from ..workflow import STAGE_BY_ID, LEGACY_STAGE_ALIAS

router = APIRouter(prefix="/api/qc-report", tags=["qc-report"])

ALLOWED_ROLES = ("primary_head", "bioinfo_head")
_guard = require_role(*ALLOWED_ROLES)

# The banner printed at the top of every PDF page. Drop the image at one of these
# paths (original aspect ratio is kept); without it the report falls back to a plain
# text title so downloads never fail.
HEADER_DIR = Path(__file__).resolve().parent.parent / "assets"
HEADER_CANDIDATES = [HEADER_DIR / f"report_header{ext}" for ext in (".png", ".jpg", ".jpeg")]
# Same idea for the banner printed at the bottom of every page.
FOOTER_CANDIDATES = [HEADER_DIR / f"report_footer{ext}" for ext in (".png", ".jpg", ".jpeg")]

# Not part of the sheet's own cell data, so offered as extra selectable columns.
QC_STATUS = "QC Status"
RESEQ = "Re-Sequencing"
EXTRA_COLUMNS = [QC_STATUS, RESEQ]

# The sheet calls this column "Description", but it holds the Anderson ID; shown under
# that name in the report. The stored column name (used for selection) is unchanged.
DISPLAY_NAMES = {"Description": "Anderson ID"}


def _label(col: str) -> str:
    return DISPLAY_NAMES.get(col, col)


def _fmt_cell(value) -> str:
    text = "" if value is None else str(value).replace("\xa0", " ").strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})(?:[ T]00:00:00)?", text)
    if m:
        try:
            return datetime(int(m[1]), int(m[2]), int(m[3])).strftime("%d-%b-%Y")
        except ValueError:
            pass
    return text


def _stage_title(stage_id: str) -> str:
    stage = STAGE_BY_ID.get(LEGACY_STAGE_ALIAS.get(stage_id, stage_id))
    return stage["title"] if stage else stage_id


def _sheet_for(db: Session, run: models.Run) -> models.Sheet | None:
    return db.query(models.Sheet).filter(models.Sheet.run_id == run.id).first()


def _sheet_columns(sheet: models.Sheet | None) -> list[str]:
    return (json.loads(sheet.columns_json) + EXTRA_COLUMNS) if sheet else []


def _sample_rows(sheet: models.Sheet) -> list[dict]:
    out = []
    for row in sheet.rows:
        cells = {k: _fmt_cell(v) for k, v in json.loads(row.cells_json).items()}
        cells[QC_STATUS] = row.qc_pass
        cells[RESEQ] = row.resequencing
        out.append(cells)
    return out


@router.get("/runs")
def list_qc_report_runs(db: Session = Depends(get_db), _user: models.User = Depends(_guard)):
    """Every run, each with the sample-level columns available inside it, so the page
    can offer the union of columns for whichever runs are ticked."""
    runs = []
    for run in db.query(models.Run).order_by(models.Run.created_at.desc()).all():
        sheet = _sheet_for(db, run)
        runs.append({
            "run_number": run.run_number,
            "status": "Completed" if run.status == "completed" else "In progress",
            "current_stage": _stage_title(run.current_stage),
            "transferred": run.created_at.strftime("%d-%b-%Y") if run.created_at else "",
            "sample_count": len(sheet.rows) if sheet else 0,
            "columns": _sheet_columns(sheet),
        })
    return {"runs": runs}


class QCReportRequest(BaseModel):
    run_numbers: List[str]
    columns: List[str]


def _pdf_text(value) -> str:
    """Built-in PDF fonts are Latin-1 only; anything else becomes '?' rather than
    failing the whole download."""
    text = str(value) if value not in (None, "") else "-"
    return text.encode("latin-1", "replace").decode("latin-1")


class _ReportPDF(FPDF):
    header_path: Path | None = None
    header_box: tuple[float, float] | None = None  # (width, height) in mm, ratio preserved
    footer_path: Path | None = None
    footer_box: tuple[float, float] | None = None

    def header(self):
        usable = self.w - self.l_margin - self.r_margin
        if self.header_path and self.header_box:
            w, h = self.header_box
            # Full-bleed banner across the top edge of the page; height comes from the
            # image's own ratio so it is never stretched.
            self.image(str(self.header_path), x=0, y=0, w=w, h=h)
            self.set_y(h + 5)
        else:
            self.set_font("Helvetica", "B", 15)
            self.set_text_color(11, 52, 98)
            self.set_xy(self.l_margin, 8)
            self.cell(usable, 8, "Anderson Diagnostics & Labs", new_x="LMARGIN", new_y="NEXT")
            self.set_draw_color(11, 52, 98)
            self.set_line_width(0.6)
            self.line(self.l_margin, self.get_y() + 1, self.l_margin + usable, self.get_y() + 1)
            self.set_y(self.get_y() + 5)
        self.set_text_color(0, 0, 0)

    def footer(self):
        fh = self.footer_box[1] if self.footer_box else 0
        if self.footer_path and self.footer_box:
            # Full-bleed along the bottom edge, ratio preserved.
            self.image(str(self.footer_path), x=0, y=self.h - fh, w=self.footer_box[0], h=fh)
        self.set_y(-(fh + 8))
        self.set_font("Helvetica", "", 7)
        self.set_text_color(130, 130, 130)
        self.cell(0, 5, f"Page {self.page_no()} of {{nb}}", align="C")


def _header_image() -> Path | None:
    return next((p for p in HEADER_CANDIDATES if p.exists()), None)


def _footer_image() -> Path | None:
    return next((p for p in FOOTER_CANDIDATES if p.exists()), None)


def _fit_banner(path: Path, page_w: float, max_h: float) -> tuple[float, float]:
    """Banner size in mm: full page width, height from the image's own ratio (never
    stretched); shrunk, ratio kept, if it would be taller than max_h."""
    from PIL import Image
    with Image.open(path) as im:
        iw, ih = im.size
    w, h = page_w, page_w * ih / iw
    if h > max_h:
        h, w = max_h, max_h * iw / ih
    return w, h


def _ordered(rows: list[dict], keys: list[str]) -> list[str]:
    """The chosen columns this run actually has, in the sheet's own order."""
    chosen = set(keys)
    return [c for c in (rows[0].keys() if rows else []) if c in chosen]


def _col_bounds(cols: list[str], rows: list[dict], font_size: float) -> list[tuple[float, float]]:
    """(minimum, ideal) width in mm per column. Minimum = longest single word, so a value
    is never broken mid-word; ideal = the longest value (capped) on one line."""
    cw = 0.185 * font_size + 0.2  # average glyph width in mm for the chosen size
    bounds = []
    for c in cols:
        values = [_label(c)] + [r.get(c, "") for r in rows]
        longest_word = min(24, max(len(w) for v in values for w in (v.split() or [""])))
        ideal = max(min(len(v), 45) for v in values)
        lo = longest_word * cw + 3.5
        bounds.append((lo, max(ideal * cw + 3.5, lo)))
    return bounds


def _fit_widths(bounds: list[tuple[float, float]], usable: float) -> list[float]:
    """Fill exactly `usable`: everyone gets their minimum, the spare room goes to the
    columns that want more, in proportion to how much more they want."""
    lo = [b[0] for b in bounds]
    want = [b[1] - b[0] for b in bounds]
    spare = usable - sum(lo)
    if spare <= 0:
        return [w * usable / sum(lo) for w in lo]
    if sum(want) <= spare:  # everything fits at its ideal width; share the leftover evenly
        extra = (spare - sum(want)) / len(lo)
        return [l + w + extra for l, w in zip(lo, want)]
    return [l + spare * w / sum(want) for l, w in zip(lo, want)]


def _build_pdf(sections: list[tuple[models.Run, list[dict]]], keys: list[str], generated_by: str) -> bytes:
    def plan(font_size: float):
        out = []
        for run, rows in sections:
            cols = _ordered(rows, keys)
            out.append((run, rows, cols, _col_bounds(cols, rows, font_size)))
        return out

    def widest(plans):
        return max((sum(b[0] for b in p[3]) for p in plans), default=0)

    # Largest type that still fits A4 portrait; failing that, A3 portrait at full size.
    font_size, plans, a4 = 8, plan(8), False
    for fs in (8, 7.5, 7, 6.5):
        candidate = plan(fs)
        if widest(candidate) <= 190:
            font_size, plans, a4 = fs, candidate, True
            break
    if not a4:
        font_size, plans = 8, plan(8)

    pdf = _ReportPDF(orientation="P", format="A4" if a4 else "A3")
    pdf.alias_nb_pages()
    pdf.set_margins(10, 10, 10)
    usable = pdf.w - 20

    pdf.header_path = _header_image()
    if pdf.header_path:
        pdf.header_box = _fit_banner(pdf.header_path, pdf.w, pdf.h * 0.25)
    pdf.footer_path = _footer_image()
    if pdf.footer_path:
        pdf.footer_box = _fit_banner(pdf.footer_path, pdf.w, pdf.h * 0.2)
    footer_h = pdf.footer_box[1] if pdf.footer_box else 0
    # Tables break onto a new page before they reach the footer banner.
    pdf.set_auto_page_break(auto=True, margin=footer_h + 12)
    pdf.add_page()

    x0 = pdf.l_margin

    # ---- title block: centred title, thin rule; generation date in the top-right corner ----
    y = pdf.get_y()
    pdf.set_xy(x0, y + 1.5)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(usable, 5, _pdf_text(f"Generated on: {datetime.now().strftime('%d %b %Y, %H:%M')}"), align="R")
    pdf.set_xy(x0, y)
    pdf.set_font("Helvetica", "B", 17)
    pdf.set_text_color(11, 52, 98)
    pdf.cell(usable, 9, "QC REPORT", align="C", new_x="LMARGIN", new_y="NEXT")
    y = pdf.get_y() + 1
    pdf.set_draw_color(240, 130, 30)
    pdf.set_line_width(0.7)
    pdf.line(x0 + usable * 0.4, y, x0 + usable * 0.6, y)
    pdf.set_y(y + 7)

    for run, rows, cols, bounds in plans:
        if pdf.will_page_break(30):
            pdf.add_page()
        # ---- run band: run name on the left, its facts on the right ----
        transferred = run.created_at.strftime("%d %b %Y") if run.created_at else "-"
        y = pdf.get_y()
        pdf.set_fill_color(236, 240, 246)
        pdf.rect(x0, y, usable, 8, style="F")
        pdf.set_fill_color(11, 52, 98)
        pdf.rect(x0, y, 1.4, 8, style="F")
        pdf.set_xy(x0 + 4, y)
        pdf.set_font("Helvetica", "B", 10.5)
        pdf.set_text_color(11, 52, 98)
        pdf.cell(usable / 2, 8, _pdf_text(f"Run: {run.run_number}"))
        pdf.set_xy(x0 + usable / 2, y)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(60, 60, 60)
        pdf.cell(usable / 2 - 4, 8, _pdf_text(
            f"Samples: {len(rows)}     Transferred: {transferred}"), align="R")
        pdf.set_text_color(0, 0, 0)
        pdf.set_fill_color(255, 255, 255)  # the table below has no fill
        pdf.set_y(y + 10.5)
        if not rows or not cols:
            pdf.set_font("Helvetica", "I", 9)
            pdf.cell(0, 6, "No sample data for the selected columns." if rows
                     else "No consolidated Excel uploaded for this run yet.", new_x="LMARGIN", new_y="NEXT")
            pdf.ln(4)
            continue

        widths = _fit_widths(bounds, usable)
        pdf.set_font("Helvetica", "", font_size)
        pdf.set_draw_color(0, 0, 0)
        pdf.set_line_width(0.2)
        with pdf.table(
            col_widths=tuple(widths),
            width=usable,
            text_align="CENTER",
            v_align="MIDDLE",
            line_height=font_size * 0.48,
            padding=1.1,
            headings_style=FontFace(emphasis="BOLD", color=(0, 0, 0)),
            borders_layout="ALL",
        ) as table:
            head = table.row()
            for c in cols:
                head.cell(_pdf_text(_label(c)), align="C")
            for r in rows:
                row = table.row()
                for c in cols:
                    row.cell(_pdf_text(r.get(c)))
        pdf.ln(6)
    return bytes(pdf.output())


@router.post("/pdf")
def download_qc_report_pdf(
    payload: QCReportRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(_guard),
):
    """The selected runs' samples, with only the selected columns, as a PDF."""
    if not payload.columns:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose at least one column")
    if not payload.run_numbers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose at least one run")

    runs = (db.query(models.Run).filter(models.Run.run_number.in_(payload.run_numbers))
            .order_by(models.Run.created_at.desc()).all())
    if not runs:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "None of the selected runs were found")

    sections = []
    for run in runs:
        sheet = _sheet_for(db, run)
        sections.append((run, _sample_rows(sheet) if sheet else []))

    pdf = _build_pdf(sections, payload.columns, user.full_name)
    filename = f"QC_Report_{datetime.now().strftime('%Y-%m-%d')}.pdf"
    return Response(
        pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
