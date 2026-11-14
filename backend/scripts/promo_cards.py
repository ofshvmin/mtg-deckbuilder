"""CLI: render printable promo cards from a `promo_codes.py generate` CSV.

One business card (3.5" x 2") per code: the Grimoire mark, the offer, and a QR
code for that card's redeem URL with the code printed beneath it for anyone who
would rather type. Run from backend/ (needs `pip install -e .[promo]`):

    python scripts/promo_cards.py promo-codes-magiccon-2026.csv
    python scripts/promo_cards.py promo-codes-magiccon-2026.csv --layout print-shop

Layouts:
  sheet       US Letter, 10 cards per page on the Avery 8371 / 5371 grid, with
              crop marks in the margin for cutting by hand. (default)
  print-shop  One card per page with 1/8" bleed on every side — the usual
              upload format for online business-card printers.

Reads only the CSV; touches no database.
"""
import argparse
import csv
import sys
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas

REPO = Path(__file__).resolve().parents[2]
ICON = REPO / "clients/apps/mobile/assets/icon.png"

CARD_W, CARD_H = 3.5 * inch, 2 * inch
BLEED = 0.125 * inch

# Sampled from the app icon, so the card and the mark share one background.
NIGHT = HexColor("#020617")
GOLD = HexColor("#e4b55b")
CREAM = HexColor("#fffbd4")
MUTED = HexColor("#94a3b8")

# Avery 8371 / 5371: 2 x 5 cards, no gutters.
SHEET_COLS, SHEET_ROWS = 2, 5
SHEET_LEFT, SHEET_TOP = 0.75 * inch, 0.5 * inch


def offer_text(days: int) -> str:
    if days % 365 == 0:
        years = days // 365
        return f"{years} YEAR{'S' if years > 1 else ''} OF PREMIUM"
    return f"{days} DAYS OF PREMIUM"


def fit(c: Canvas, text: str, font: str, size: float, width: float, x: float, y: float) -> None:
    """Draw `text`, shrinking the font until it fits `width` — the offer line
    varies with --days, and nothing may run under the QR panel."""
    while size > 4 and stringWidth(text, font, size) > width:
        size -= 0.25
    c.setFont(font, size)
    c.drawString(x, y, text)


def draw_card(c: Canvas, x: float, y: float, row: dict, bleed: float = 0.0) -> None:
    """Draw one card with its lower-left trim corner at (x, y)."""
    c.setFillColor(NIGHT)
    c.rect(x - bleed, y - bleed, CARD_W + 2 * bleed, CARD_H + 2 * bleed, stroke=0, fill=1)

    # Just over the 1/8" safe zone printers ask for, so trimming can't clip text.
    pad = 0.14 * inch
    gutter = 0.1 * inch

    # Right: QR on a cream panel. Dark-on-light with a quiet zone is what phone
    # cameras expect; a light-on-dark code scans unreliably.
    panel = 1.42 * inch
    px, py = x + CARD_W - pad - panel, y + (CARD_H - panel) / 2
    c.setFillColor(CREAM)
    c.roundRect(px, py, panel, panel, 6, stroke=0, fill=1)
    qr = QrCodeWidget(row["url"], barLevel="M", barFillColor=NIGHT)
    qr_size = panel - 0.24 * inch  # leaves a strip for the printed code
    x0, y0, x1, y1 = qr.getBounds()
    d = Drawing(qr_size, qr_size, transform=[qr_size / (x1 - x0), 0, 0, qr_size / (y1 - y0), 0, 0])
    d.add(qr)
    renderPDF.draw(d, c, px + (panel - qr_size) / 2, py + 0.2 * inch)
    c.setFillColor(NIGHT)
    c.setFont("Courier-Bold", 9.5)
    c.drawCentredString(px + panel / 2, py + 0.09 * inch, row["code"])

    # Left: mark and name, offer, instructions — top, middle, bottom.
    lx = x + pad
    width = px - gutter - lx
    icon = 0.42 * inch
    top = y + CARD_H - pad
    c.drawImage(str(ICON), lx - 4, top - icon, icon, icon)
    c.setFillColor(GOLD)
    fit(c, "Grimoire", "Times-Bold", 17, width - icon, lx + icon, top - icon / 2 - 5)
    c.setFillColor(MUTED)
    fit(c, "AI-powered Commander decks", "Helvetica", 7, width, lx, top - icon - 8)

    c.setFillColor(CREAM)
    fit(c, offer_text(int(row["days"])), "Helvetica-Bold", 10.5, width, lx, y + 0.74 * inch)
    c.setFillColor(GOLD)
    fit(c, "FREE", "Helvetica-Bold", 10.5, width, lx, y + 0.58 * inch)

    c.setFillColor(MUTED)
    fit(c, "Scan to claim, or enter your code at", "Helvetica", 6.5, width, lx, y + 0.36 * inch)
    c.setFillColor(CREAM)
    fit(c, "grimoire.dankodev.app/redeem", "Helvetica-Bold", 7, width, lx, y + 0.24 * inch)
    fine_print = "One per account."
    if row.get("expires_at"):
        fine_print = f"Redeem by {row['expires_at'][:10]}. {fine_print}"
    c.setFillColor(MUTED)
    fit(c, fine_print, "Helvetica", 5.5, width, lx, y + pad)


def crop_marks(c: Canvas, rows_on_page: int) -> None:
    """Ticks in the page margin on every cut line. The cards sit edge to edge,
    so marks at the card corners themselves would print onto the neighbours."""
    _, page_h = letter
    used_rows = (rows_on_page + SHEET_COLS - 1) // SHEET_COLS
    left, right = SHEET_LEFT, SHEET_LEFT + SHEET_COLS * CARD_W
    top = page_h - SHEET_TOP
    bottom = top - used_rows * CARD_H
    gap, length = 4, 14
    c.setStrokeColor(MUTED)
    c.setLineWidth(0.3)
    for i in range(SHEET_COLS + 1):
        x = left + i * CARD_W
        c.line(x, top + gap, x, top + gap + length)
        c.line(x, bottom - gap, x, bottom - gap - length)
    for j in range(used_rows + 1):
        y = top - j * CARD_H
        c.line(left - gap, y, left - gap - length, y)
        c.line(right + gap, y, right + gap + length, y)


def render(rows: list[dict], out: Path, layout: str) -> None:
    if layout == "print-shop":
        c = Canvas(str(out), pagesize=(CARD_W + 2 * BLEED, CARD_H + 2 * BLEED))
        for row in rows:
            draw_card(c, BLEED, BLEED, row, bleed=BLEED)
            c.showPage()
        c.save()
        return

    c = Canvas(str(out), pagesize=letter)
    _, page_h = letter
    per_page = SHEET_COLS * SHEET_ROWS
    for start in range(0, len(rows), per_page):
        page = rows[start : start + per_page]
        for slot, row in enumerate(page):
            col, r = slot % SHEET_COLS, slot // SHEET_COLS
            x = SHEET_LEFT + col * CARD_W
            y = page_h - SHEET_TOP - (r + 1) * CARD_H
            draw_card(c, x, y, row)
        crop_marks(c, len(page))
        c.showPage()
    c.save()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv", type=Path, help="CSV written by promo_codes.py generate")
    parser.add_argument("--layout", choices=["sheet", "print-shop"], default="sheet")
    parser.add_argument("--out", type=Path, help="PDF path (default promo-cards-<batch>.pdf)")
    args = parser.parse_args()

    with args.csv.open(newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        print(f"ERROR: {args.csv} has no codes.", file=sys.stderr)
        return 1

    suffix = "" if args.layout == "sheet" else f"-{args.layout}"
    out = args.out or Path(f"promo-cards-{rows[0]['batch']}{suffix}.pdf")
    render(rows, out, args.layout)
    print(f"Wrote {len(rows)} cards to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
