// Build a "scavenger list": a print-ready PDF pull-guide + checklist for a deck,
// matched to how the collection is stored (by set, then color). Two lists —
// Rares & Mythics, then Commons & Uncommons — each grouped by set (newest first)
// → color → alphabetical. Sets are merged by parent (e.g. Edge of Eternities
// Commander → Edge of Eternities). Multi-column layout to minimize pages.
import type { GeneratedDeck } from "@mtg/shared";
import { loadSetIndex, type SetIndex } from "./scryfallSets";

const COLOR_ORDER = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless", "Lands", "—"];
const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const RARITY_TAG: Record<string, string> = { mythic: "M", rare: "R", uncommon: "U", common: "C", special: "S", bonus: "S" };

const RARES = "Rares & Mythics";
const COMMONS = "Commons & Uncommons";
const OTHER = "Other";

function colorGroup(colors: string[], typeLine: string): string {
  if (/\bland\b/i.test(typeLine)) return "Lands";
  if (colors.length === 0) return "Colorless";
  if (colors.length > 1) return "Multicolor";
  return COLOR_NAME[colors[0]] ?? "Colorless";
}

function rarityTier(rarity: string): string {
  if (rarity === "common" || rarity === "uncommon") return COMMONS;
  if (!rarity) return OTHER;
  return RARES;
}

/** Resolve a set code to its parent (superset), or itself if it has no parent. */
function resolveParent(sets: SetIndex, code: string): string {
  const info = sets.get(code);
  return info?.parentCode ?? code;
}

// ---- Data model ----
export interface ScavCard { name: string; tag: string }
export interface ScavColorGroup { color: string; cards: ScavCard[] }
export interface ScavSet { code: string; name: string; released: string; colors: ScavColorGroup[] }
export interface ScavTier { title: string; sets: ScavSet[] }
export interface ScavMultiple { name: string; sets: { code: string; name: string }[] }
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
  return sets.get(code)?.name ?? code.toUpperCase();
}
function setReleased(sets: SetIndex, code: string): string {
  return sets.get(code)?.released ?? "0000-00-00";
}

export async function buildScavengerData(deck: GeneratedDeck, deckName: string): Promise<ScavData> {
  const ids: { set: string; collector_number: string }[] = [];
  const entries: { name: string; set: string; collector: string; deckColors: string[]; deckType: string }[] = [];
  // Track which parent sets each card appears in (for the multiples section)
  const cardParentSets = new Map<string, Set<string>>();

  for (const card of deck.cards) {
    if (card.oracle_id.startsWith("basic:")) continue;
    const printings = card.printings ?? [];
    if (printings.length === 0) {
      entries.push({
        name: card.name, set: "", collector: "",
        deckColors: card.color_identity, deckType: card.type_line,
      });
      continue;
    }
    for (const p of printings) {
      if (!p.edition) continue;
      const set = p.edition.toLowerCase();
      const collector = p.collector_number ?? "";
      entries.push({
        name: card.name, set, collector,
        deckColors: card.color_identity, deckType: card.type_line,
      });
      if (collector) ids.push({ set, collector_number: collector });
    }
  }

  const [data, sets] = await Promise.all([fetchCardData(ids), loadSetIndex()]);

  // Populate cardParentSets now that we have the set index
  for (const e of entries) {
    if (!e.set) continue;
    const parent = resolveParent(sets, e.set);
    const s = cardParentSets.get(e.name) ?? new Set<string>();
    s.add(parent);
    cardParentSets.set(e.name, s);
  }

  // tier -> parent set code -> color -> cards[] (deduplicated by name)
  const grouped: Record<string, Record<string, Record<string, ScavCard[]>>> = {};
  const seen = new Map<string, Set<string>>(); // "tier:parentSet:color" -> card names already added
  for (const e of entries) {
    const d = data.get(`${e.set}:${e.collector}`);
    const colors = d ? d.colors : e.deckColors;
    const typeLine = d ? d.typeLine : e.deckType;
    const rarity = d?.rarity ?? "";
    const tier = rarity ? rarityTier(rarity) : OTHER;
    const color = colorGroup(colors, typeLine);
    const tag = rarity ? (RARITY_TAG[rarity] ?? "") : "";
    const parentCode = e.set ? resolveParent(sets, e.set) : "unknown";

    // Deduplicate: same card name appearing multiple times under the same
    // parent set + color (e.g. from commander deck + main set printings)
    const key = `${tier}:${parentCode}:${color}`;
    const already = seen.get(key) ?? new Set<string>();
    if (already.has(e.name)) continue;
    already.add(e.name);
    seen.set(key, already);

    (((grouped[tier] ??= {})[parentCode] ??= {})[color] ??= []).push({ name: e.name, tag });
  }

  const tiers: ScavTier[] = [];
  for (const title of [RARES, COMMONS, OTHER]) {
    const bySet = grouped[title];
    if (!bySet) continue;
    const setCodes = Object.keys(bySet).sort((a, b) => {
      const r = setReleased(sets, b).localeCompare(setReleased(sets, a));
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

  // Multiples: cards owned across 2+ parent sets
  const multiples: ScavMultiple[] = [...cardParentSets.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([name, s]) => ({
      name,
      sets: [...s]
        .map((code) => ({ code, name: setName(sets, code) }))
        .sort((a, b) => setReleased(sets, b.code).localeCompare(setReleased(sets, a.code))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { deckName, commander: deck.commander.name, total: deck.total, tiers, multiples };
}

// ---- PDF rendering (jsPDF, dynamically imported so it code-splits out) ----

// Layout constants (US Letter in points: 612 x 792)
const M_LEFT = 36;
const M_RIGHT = 36;
const M_TOP = 40;
const M_BOTTOM = 40;
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const BOTTOM = PAGE_H - M_BOTTOM;

// Column layout
const COL_GAP = 14;
const NUM_COLS = 3;
const COL_W = (CONTENT_W - COL_GAP * (NUM_COLS - 1)) / NUM_COLS;

// Spacing
const CARD_LINE_H = 11;
const COLOR_HEADING_H = 13;
const SET_HEADING_H = 16;
const SECTION_GAP = 10;
const CB_SIZE = 6.5;
const CB_Y_OFFSET = -5.5;

// A "block" is a contiguous chunk that shouldn't be split across columns:
// a set heading + its color groups. We pre-measure all blocks, then flow
// them into columns page by page.
interface Block {
  type: "tier-heading" | "set" | "multiples-heading" | "multiple";
  height: number;
  render: (doc: any, x: number, y: number) => void;
}

export async function downloadScavengerPdf(data: ScavData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  // --- drawing helpers (all take absolute x, y) ---
  function txt(s: string, x: number, yy: number, size: number, style: "normal" | "bold", gray: number) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(gray);
    doc.text(s, x, yy);
  }

  function txtRight(s: string, x: number, yy: number, size: number, style: "normal" | "bold", gray: number) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(gray);
    doc.text(s, x, yy, { align: "right" });
  }

  function checkbox(x: number, yy: number) {
    doc.setDrawColor(140);
    doc.setLineWidth(0.5);
    doc.rect(x, yy + CB_Y_OFFSET, CB_SIZE, CB_SIZE);
  }

  function rule(x1: number, x2: number, yy: number) {
    doc.setDrawColor(180);
    doc.setLineWidth(0.5);
    doc.line(x1, yy, x2, yy);
  }

  // --- Build blocks ---
  const blocks: Block[] = [];

  for (const tier of data.tiers) {
    // Tier heading block
    blocks.push({
      type: "tier-heading",
      height: 20,
      render: (_doc, x, yy) => {
        txt(tier.title.toUpperCase(), x, yy + 12, 10, "bold", 40);
        rule(x, x + COL_W, yy + 16);
      },
    });

    for (const set of tier.sets) {
      // Calculate the height this set block needs
      let h = SET_HEADING_H;
      for (const cg of set.colors) {
        h += COLOR_HEADING_H;
        h += cg.cards.length * CARD_LINE_H;
      }

      blocks.push({
        type: "set",
        height: h,
        render: (_doc, x, yy) => {
          let cy = yy;
          txt(`${set.name} (${set.code.toUpperCase()})`, x, cy + 10, 8.5, "bold", 50);
          cy += SET_HEADING_H;

          for (const cg of set.colors) {
            txt(cg.color, x + 2, cy + 9, 7.5, "bold", 110);
            cy += COLOR_HEADING_H;

            for (const card of cg.cards) {
              checkbox(x + 4, cy + 7);
              txt(card.name, x + 4 + CB_SIZE + 4, cy + 8, 8, "normal", 30);
              if (card.tag) {
                txtRight(card.tag, x + COL_W, cy + 8, 7, "normal", 160);
              }
              cy += CARD_LINE_H;
            }
          }
        },
      });
    }
  }

  // Multiples section
  if (data.multiples.length > 0) {
    blocks.push({
      type: "multiples-heading",
      height: 20,
      render: (_doc, x, yy) => {
        txt(`MULTIPLES — owned in 2+ sets (${data.multiples.length})`, x, yy + 12, 10, "bold", 40);
        rule(x, x + COL_W, yy + 16);
      },
    });

    for (const m of data.multiples) {
      const setsLine = m.sets.map((s) => s.name).join(", ");
      // Estimate wrapped height
      const charsPer = Math.floor(COL_W / 4); // rough chars per line at font size 7
      const lines = Math.ceil(setsLine.length / charsPer) || 1;
      const h = CARD_LINE_H + lines * 9 + 4;

      blocks.push({
        type: "multiple",
        height: h,
        render: (_doc, x, yy) => {
          checkbox(x, yy + 7);
          txt(m.name, x + CB_SIZE + 4, yy + 8, 8, "bold", 30);
          const wrapped = doc.splitTextToSize(setsLine, COL_W - 16) as string[];
          let ly = yy + CARD_LINE_H + 2;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(120);
          for (const line of wrapped) {
            doc.text(line, x + CB_SIZE + 4, ly);
            ly += 9;
          }
        },
      });
    }
  }

  // --- Flow blocks into columns ---

  // Draw the header on page 1
  txt("Scavenger List", M_LEFT, M_TOP + 14, 16, "bold", 20);
  txt(data.deckName, M_LEFT, M_TOP + 28, 10, "normal", 60);
  txt(
    `${data.commander}  ·  ${data.total} cards  ·  ${new Date().toLocaleDateString()}  ·  basic lands excluded`,
    M_LEFT, M_TOP + 40, 8, "normal", 120,
  );
  rule(M_LEFT, PAGE_W - M_RIGHT, M_TOP + 46);

  let colY = M_TOP + 56; // start of content area on page 1
  let colIdx = 0;

  function colX(): number {
    return M_LEFT + colIdx * (COL_W + COL_GAP);
  }

  function nextCol() {
    colIdx++;
    if (colIdx >= NUM_COLS) {
      doc.addPage();
      colIdx = 0;
      colY = M_TOP;
    } else {
      colY = M_TOP + (doc.getNumberOfPages() === 1 ? 56 : 0);
    }
  }

  for (const block of blocks) {
    // If block doesn't fit in this column, move to next
    if (colY + block.height > BOTTOM) {
      nextCol();
    }

    // If a tier/multiples heading, try to span all remaining columns
    if (block.type === "tier-heading" || block.type === "multiples-heading") {
      // If not at start of a column, advance to next column
      if (colY > M_TOP + (doc.getNumberOfPages() === 1 ? 56 : 0) + 2) {
        // Start a fresh row of columns for a new tier
        nextCol();
        // Reset to column 0 on this page for the heading
        if (colIdx !== 0) {
          doc.addPage();
          colIdx = 0;
          colY = M_TOP;
        }
      }
      block.render(doc, M_LEFT, colY);
      colY += block.height;
      continue;
    }

    // For set/multiple blocks: if it's too tall for any single column,
    // just render it and let it overflow (rare edge case)
    block.render(doc, colX(), colY);
    colY += block.height + 4;
  }

  // --- Footer on every page ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(170);
    doc.text(`Page ${p} of ${totalPages}`, PAGE_W - M_RIGHT, PAGE_H - 24, { align: "right" });
    doc.text(data.deckName, M_LEFT, PAGE_H - 24);
  }

  const safe = data.deckName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
  doc.save(`${safe}-scavenger-list.pdf`);
}
