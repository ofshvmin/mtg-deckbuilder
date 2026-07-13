// Build a "scavenger list": a print-ready PDF pull-guide + checklist for a deck,
// matched to how the collection is stored (by set, then color). Two lists —
// Rares & Mythics, then Commons & Uncommons — each grouped by set (newest first)
// → color (lands their own group) → alphabetical, plus a "multiples" checklist
// for cards owned across 2+ sets. Client-side: rarity/colors are per-printing
// (Scryfall), set names + release dates come from the /sets index.
import type { GeneratedDeck } from "@mtg/shared";
import { loadSetIndex, type SetIndex } from "./scryfallSets";

const COLOR_ORDER = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless", "Lands", "—"];
const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const RARITY_TAG: Record<string, string> = { mythic: "M", rare: "R", uncommon: "U", common: "C", special: "S", bonus: "S" };

const RARES = "Rares & Mythics";
const COMMONS = "Commons & Uncommons";
const OTHER = "Other (printing not resolved)";

function colorGroup(colors: string[], typeLine: string): string {
  if (/\bland\b/i.test(typeLine)) return "Lands";
  if (colors.length === 0) return "Colorless";
  if (colors.length > 1) return "Multicolor";
  return COLOR_NAME[colors[0]] ?? "Colorless";
}

function rarityTier(rarity: string): string {
  if (rarity === "common" || rarity === "uncommon") return COMMONS;
  if (!rarity) return OTHER;
  return RARES; // rare, mythic, special, bonus
}

// ---- Data model ----
export interface ScavCard { name: string; collector: string; tag: string }
export interface ScavColorGroup { color: string; cards: ScavCard[] }
export interface ScavSet { code: string; name: string; released: string; colors: ScavColorGroup[] }
export interface ScavTier { title: string; sets: ScavSet[] }
export interface ScavMultiple { name: string; sets: { code: string; name: string; released: string }[] }
export interface ScavData {
  deckName: string;
  commander: string;
  total: number;
  tiers: ScavTier[];
  multiples: ScavMultiple[];
}

interface CardData { rarity: string; colors: string[]; typeLine: string }

async function fetchCardData(ids: { set: string; collector_number: string }[]): Promise<Map<string, CardData>> {
  const out = new Map<string, CardData>();
  for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75);
    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk }),
      });
      if (!res.ok) continue;
      const body = await res.json();
      for (const c of body.data ?? []) {
        out.set(`${c.set}:${c.collector_number}`, {
          rarity: c.rarity ?? "",
          colors: c.colors ?? c.card_faces?.[0]?.colors ?? [],
          typeLine: c.type_line ?? "",
        });
      }
    } catch {
      /* skip chunk */
    }
  }
  return out;
}

function setName(sets: SetIndex, code: string): string {
  const info = sets.get(code);
  return info ? info.name : code.toUpperCase();
}
function setReleased(sets: SetIndex, code: string): string {
  return sets.get(code)?.released ?? "0000-00-00";
}

export async function buildScavengerData(deck: GeneratedDeck, deckName: string): Promise<ScavData> {
  const ids: { set: string; collector_number: string }[] = [];
  const entries: { name: string; set: string; collector: string }[] = [];
  const cardSets = new Map<string, Set<string>>(); // card name -> distinct set codes owned

  for (const card of deck.cards) {
    if (card.oracle_id.startsWith("basic:")) continue;
    for (const p of card.printings ?? []) {
      if (!p.edition) continue;
      const set = p.edition.toLowerCase();
      const collector = p.collector_number ?? "";
      entries.push({ name: card.name, set, collector });
      if (collector) ids.push({ set, collector_number: collector });
      (cardSets.get(card.name) ?? cardSets.set(card.name, new Set()).get(card.name)!).add(set);
    }
  }

  const [data, sets] = await Promise.all([fetchCardData(ids), loadSetIndex()]);

  // tier -> set code -> color -> cards[]
  const grouped: Record<string, Record<string, Record<string, ScavCard[]>>> = {};
  for (const e of entries) {
    const d = data.get(`${e.set}:${e.collector}`);
    const tier = d ? rarityTier(d.rarity) : OTHER;
    const color = d ? colorGroup(d.colors, d.typeLine) : "—";
    const tag = d ? RARITY_TAG[d.rarity] ?? "" : "";
    (((grouped[tier] ??= {})[e.set] ??= {})[color] ??= []).push({ name: e.name, collector: e.collector, tag });
  }

  const tiers: ScavTier[] = [];
  for (const title of [RARES, COMMONS, OTHER]) {
    const bySet = grouped[title];
    if (!bySet) continue;
    const setCodes = Object.keys(bySet).sort((a, b) => {
      const r = setReleased(sets, b).localeCompare(setReleased(sets, a)); // newest first
      return r !== 0 ? r : setName(sets, a).localeCompare(setName(sets, b));
    });
    const scavSets: ScavSet[] = setCodes.map((code) => {
      const byColor = bySet[code];
      const colorsPresent = COLOR_ORDER.filter((c) => byColor[c]).concat(
        Object.keys(byColor).filter((c) => !COLOR_ORDER.includes(c)),
      );
      return {
        code,
        name: setName(sets, code),
        released: setReleased(sets, code),
        colors: colorsPresent.map((color) => ({
          color,
          cards: byColor[color].slice().sort((a, b) => a.name.localeCompare(b.name)),
        })),
      };
    });
    tiers.push({ title, sets: scavSets });
  }

  const multiples: ScavMultiple[] = [...cardSets.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([name, s]) => ({
      name,
      sets: [...s]
        .map((code) => ({ code, name: setName(sets, code), released: setReleased(sets, code) }))
        .sort((a, b) => b.released.localeCompare(a.released)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { deckName, commander: deck.commander.name, total: deck.total, tiers, multiples };
}

// ---- PDF rendering (jsPDF, dynamically imported so it code-splits out) ----

// Layout constants (US Letter in points: 612 x 792)
const M_LEFT = 50;           // left margin
const M_RIGHT = 50;          // right margin
const M_TOP = 50;            // top margin
const M_BOTTOM = 50;         // bottom margin
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const BOTTOM = PAGE_H - M_BOTTOM;

// Spacing
const TIER_HEADING_H = 32;   // height reserved for tier heading + rule
const SET_HEADING_H = 20;    // height for a set name
const COLOR_HEADING_H = 16;  // height for a color subgroup label
const CARD_LINE_H = 15;      // height per card row
const SECTION_GAP = 14;      // gap between sections
const SET_GAP = 10;           // gap after a set
const COLOR_GAP = 4;          // gap after a color group

// Indent levels
const INDENT_SET = 0;
const INDENT_COLOR = 16;
const INDENT_CHECKBOX = 30;
const INDENT_NAME = 46;

// Checkbox
const CB_SIZE = 8;
const CB_Y_OFFSET = -7;      // relative to text baseline

export async function downloadScavengerPdf(data: ScavData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  let y = M_TOP;
  let pageNum = 1;

  // --- helpers ---
  function newPage() {
    doc.addPage();
    y = M_TOP;
    pageNum++;
  }

  function ensure(h: number) {
    if (y + h > BOTTOM) newPage();
  }

  function drawText(s: string, x: number, size: number, style: "normal" | "bold" | "italic", gray: number) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(gray);
    doc.text(s, M_LEFT + x, y);
  }

  function drawTextRight(s: string, size: number, style: "normal" | "bold" | "italic", gray: number) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(gray);
    doc.text(s, PAGE_W - M_RIGHT, y, { align: "right" });
  }

  function drawCheckbox(x: number) {
    doc.setDrawColor(140);
    doc.setLineWidth(0.6);
    doc.rect(M_LEFT + x, y + CB_Y_OFFSET, CB_SIZE, CB_SIZE);
  }

  function drawRule(yPos: number) {
    doc.setDrawColor(190);
    doc.setLineWidth(0.6);
    doc.line(M_LEFT, yPos, PAGE_W - M_RIGHT, yPos);
  }

  // --- Header ---
  drawText("Scavenger List", 0, 20, "bold", 20);
  y += 6;
  drawText(data.deckName, 0, 13, "normal", 60);
  y += 18;
  drawText(
    `${data.commander}  ·  ${data.total} cards  ·  ${new Date().toLocaleDateString()}  ·  basic lands excluded`,
    0, 9, "normal", 120,
  );
  y += 6;
  drawRule(y);
  y += SECTION_GAP;

  // --- Tier sections ---
  for (const tier of data.tiers) {
    // Tier heading
    ensure(TIER_HEADING_H + SET_HEADING_H);
    drawText(tier.title.toUpperCase(), 0, 13, "bold", 30);
    y += 4;
    drawRule(y);
    y += SECTION_GAP;

    for (let si = 0; si < tier.sets.length; si++) {
      const set = tier.sets[si];

      // Count total cards in this set to decide if we should page-break before
      const setCardCount = set.colors.reduce((sum, cg) => sum + cg.cards.length, 0);
      const setMinH = SET_HEADING_H + COLOR_HEADING_H + Math.min(setCardCount, 3) * CARD_LINE_H;
      ensure(setMinH);

      // Set heading
      drawText(`${set.name}  (${set.code.toUpperCase()})`, INDENT_SET, 11, "bold", 40);
      y += SET_HEADING_H;

      for (const cg of set.colors) {
        ensure(COLOR_HEADING_H + CARD_LINE_H);

        // Color subgroup label
        drawText(cg.color, INDENT_COLOR, 9, "bold", 100);
        y += COLOR_HEADING_H;

        for (const card of cg.cards) {
          ensure(CARD_LINE_H);

          // Checkbox
          drawCheckbox(INDENT_CHECKBOX);

          // Card name
          drawText(card.name, INDENT_NAME, 10, "normal", 30);

          // Right-aligned: rarity tag + collector number
          const parts: string[] = [];
          if (card.tag) parts.push(card.tag);
          if (card.collector) parts.push(`#${card.collector}`);
          if (parts.length) {
            drawTextRight(parts.join("   "), 8, "normal", 160);
          }

          y += CARD_LINE_H;
        }
        y += COLOR_GAP;
      }
      y += SET_GAP;
    }
    y += SECTION_GAP;
  }

  // --- Multiples section ---
  if (data.multiples.length > 0) {
    ensure(TIER_HEADING_H + 30);
    drawText(`MULTIPLES  —  owned in 2+ sets  (${data.multiples.length})`, 0, 13, "bold", 30);
    y += 4;
    drawRule(y);
    y += SECTION_GAP;

    for (const m of data.multiples) {
      ensure(CARD_LINE_H + 14);

      // Checkbox + card name
      drawCheckbox(0);
      drawText(m.name, 16, 10, "bold", 30);
      y += CARD_LINE_H;

      // Set list underneath, indented
      const setsLine = m.sets.map((s) => `${s.name} (${s.code.toUpperCase()})`).join(",  ");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120);
      const wrapped = doc.splitTextToSize(setsLine, CONTENT_W - 24) as string[];
      for (const line of wrapped) {
        ensure(11);
        doc.text(line, M_LEFT + 20, y);
        y += 11;
      }
      y += 6;
    }
  }

  // --- Footer on every page ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(170);
    doc.text(`Page ${p} of ${totalPages}`, PAGE_W - M_RIGHT, PAGE_H - 28, { align: "right" });
    doc.text(data.deckName, M_LEFT, PAGE_H - 28);
  }

  const safe = data.deckName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
  doc.save(`${safe}-scavenger-list.pdf`);
}
