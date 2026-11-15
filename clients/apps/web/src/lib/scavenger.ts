// The pull list as a print-ready PDF: multi-column, checkboxes, to minimize
// pages. The data comes from @mtg/shared's buildScavengerData.
import { COMMONS, RARES, type ScavData } from "@mtg/shared";

// ---- PDF rendering ----

const ML = 36;             // left margin
const MR = 36;             // right margin
const MT = 40;             // top margin
const PAGE_W = 612;
const PAGE_H = 792;
const USABLE_W = PAGE_W - ML - MR;
const USABLE_BOTTOM = PAGE_H - 40;

const COLS = 3;
const COL_GAP = 14;
const COL_W = (USABLE_W - COL_GAP * (COLS - 1)) / COLS;

const LINE = 11;           // card line height
const COLOR_H = 12;        // color heading height
const SET_H = 16;          // set heading height
const CB = 6;              // checkbox size

export async function downloadScavengerPdf(data: ScavData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  // ---- primitives ----
  const t = (s: string, x: number, y: number, sz: number, bold: boolean, gray: number) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(sz); doc.setTextColor(gray); doc.text(s, x, y);
  };
  const tR = (s: string, x: number, y: number, sz: number, gray: number) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(sz); doc.setTextColor(gray); doc.text(s, x, y, { align: "right" });
  };
  const box = (x: number, y: number) => {
    doc.setDrawColor(140); doc.setLineWidth(0.5); doc.rect(x, y - 5, CB, CB);
  };
  const rule = (y: number) => {
    doc.setDrawColor(180); doc.setLineWidth(0.5); doc.line(ML, y, PAGE_W - MR, y);
  };

  // ---- column cursor ----
  let col = 0;
  let cy = MT;
  // The top of the content area on the current page. On page 1 this is
  // pushed down by the header; on subsequent pages it's just MT.
  let pageContentTop = MT;

  const colX = () => ML + col * (COL_W + COL_GAP);

  function need(h: number) {
    if (cy + h <= USABLE_BOTTOM) return; // fits
    col++;
    if (col >= COLS) { doc.addPage(); col = 0; pageContentTop = MT; }
    cy = pageContentTop;
  }

  // Draw a column-width section label. Treated like any other block.
  function sectionLabel(title: string) {
    need(24);
    t(title.toUpperCase(), colX(), cy + 11, 9, true, 40);
    doc.setDrawColor(160); doc.setLineWidth(0.5);
    doc.line(colX(), cy + 15, colX() + COL_W, cy + 15);
    cy += 22;
  }

  // ---- page 1 header (full-width, before any columns) ----
  t("Scavenger List", ML, cy + 14, 16, true, 20);
  t(data.deckName, ML, cy + 28, 10, false, 60);
  t(
    `${data.commander}  ·  ${data.total} cards  ·  ${new Date().toLocaleDateString()}  ·  basic lands excluded`,
    ML, cy + 40, 8, false, 120,
  );
  rule(cy + 46);
  cy += 56;
  pageContentTop = cy; // all columns on page 1 start below the header

  // ---- RARES & MYTHICS (flat alphabetical per set) ----
  if (data.rareSets.length) {
    sectionLabel(RARES);
    for (const set of data.rareSets) {
      need(SET_H + Math.min(set.cards.length, 2) * LINE);
      t(`${set.name} (${set.code.toUpperCase()})`, colX(), cy + 10, 8, true, 50);
      cy += SET_H;
      for (const card of set.cards) {
        need(LINE);
        box(colX() + 2, cy + 7);
        t(card.name, colX() + 2 + CB + 3, cy + 8, 8, false, 30);
        if (card.tag) tR(card.tag, colX() + COL_W, cy + 8, 7, 160);
        cy += LINE;
      }
      cy += 4;
    }
  }

  // ---- COMMONS & UNCOMMONS (set → color → alphabetical) ----
  if (data.commonSets.length) {
    sectionLabel(COMMONS);
    for (const set of data.commonSets) {
      need(SET_H + COLOR_H + LINE);
      t(`${set.name} (${set.code.toUpperCase()})`, colX(), cy + 10, 8, true, 50);
      cy += SET_H;
      for (const cg of set.colors) {
        need(COLOR_H + LINE);
        t(cg.color, colX() + 2, cy + 8, 7, true, 110);
        cy += COLOR_H;
        for (const card of cg.cards) {
          need(LINE);
          box(colX() + 4, cy + 7);
          t(card.name, colX() + 4 + CB + 3, cy + 8, 8, false, 30);
          if (card.tag) tR(card.tag, colX() + COL_W, cy + 8, 7, 160);
          cy += LINE;
        }
      }
      cy += 4;
    }
  }

  // ---- MULTIPLES ----
  if (data.multiples.length) {
    sectionLabel("Multiples — owned in 2+ sets");
    for (const m of data.multiples) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      const setsStr = m.sets.join(", ");
      const wrapped = doc.splitTextToSize(setsStr, COL_W - CB - 6) as string[];
      const h = 14 + wrapped.length * 9 + 6;
      need(h);
      box(colX(), cy + 7);
      t(m.name, colX() + CB + 3, cy + 8, 8, true, 30);
      cy += 14; // enough clearance below the bold card name
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120);
      for (const line of wrapped) {
        doc.text(line, colX() + CB + 3, cy);
        cy += 9;
      }
      cy += 6;
    }
  }

  // ---- page footers ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    t(data.deckName, ML, PAGE_H - 22, 7, false, 170);
    tR(`Page ${p} of ${pages}`, PAGE_W - MR, PAGE_H - 22, 7, 170);
  }

  const safe = data.deckName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
  doc.save(`${safe}-scavenger-list.pdf`);
}
