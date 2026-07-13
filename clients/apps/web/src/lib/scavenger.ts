// Build a "scavenger list": a print-ready PDF pull-guide + checklist for a deck.
// Two sections: Rares & Mythics (flat alphabetical per set), then Commons &
// Uncommons (grouped set → color → alphabetical). Sets are merged into their
// "superset" — same parent_set_code, or same product family by name prefix.
// Multi-column layout to minimize pages.
import type { GeneratedDeck } from "@mtg/shared";
import { loadSetIndex, type SetIndex } from "./scryfallSets";

const COLOR_ORDER = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless", "Lands"];
const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const RARITY_TAG: Record<string, string> = { mythic: "M", rare: "R", uncommon: "U", common: "C", special: "S", bonus: "S" };

const RARES = "Rares & Mythics";
const COMMONS = "Commons & Uncommons";

function colorGroup(colors: string[], typeLine: string): string {
  if (/\bland\b/i.test(typeLine)) return "Lands";
  if (colors.length === 0) return "Colorless";
  if (colors.length > 1) return "Multicolor";
  return COLOR_NAME[colors[0]] ?? "Colorless";
}

function isRare(rarity: string): boolean {
  return rarity === "rare" || rarity === "mythic" || rarity === "special" || rarity === "bonus";
}

// ---- Superset resolution ----
// Merge child sets into their parent (e.g. EOC → EOE). For sets without a
// parent (masterpiece, promo, etc.), fall back to grouping by the first
// significant word of the set name (e.g. "Marvel Universe" + "Marvel Super
// Heroes" → both resolve to the "Marvel ..." expansion).

function buildSupersetMap(sets: SetIndex): Map<string, string> {
  const map = new Map<string, string>();

  // First pass: follow parent_set_code chains to their root
  for (const [code, info] of sets) {
    let root = code;
    let depth = 0;
    while (depth < 5) {
      const parent = sets.get(root)?.parentCode;
      if (!parent || parent === root) break;
      root = parent;
      depth++;
    }
    map.set(code, root);
  }

  // Second pass: for orphan non-expansion sets (masterpiece, promo, box,
  // funny, etc.) that resolved to themselves, try to match by name prefix to
  // the nearest expansion/commander set.
  const CHILD_TYPES = new Set(["masterpiece", "promo", "box", "spellbook", "from_the_vault", "premium_deck", "funny"]);
  const expansionsByPrefix = new Map<string, string>(); // first word → expansion code
  for (const [code, info] of sets) {
    // Only consider root-level sets (no parent) as candidate parents
    if (info.parentCode) continue;
    const firstWord = info.name.split(/\s+/)[0]?.toLowerCase();
    if (!firstWord || firstWord.length < 3) continue;
    // Prefer the earliest (most canonical) expansion for this prefix
    if (!expansionsByPrefix.has(firstWord)) {
      expansionsByPrefix.set(firstWord, code);
    } else {
      // Keep the one with the earlier release date (more likely to be the "main" set)
      const existing = sets.get(expansionsByPrefix.get(firstWord)!);
      if (existing && info.released && existing.released && info.released < existing.released) {
        expansionsByPrefix.set(firstWord, code);
      }
    }
  }

  for (const [code, info] of sets) {
    if (map.get(code) !== code) continue; // already has a parent
    const setType = (info as any).setType; // not available, so check by heuristic
    const firstWord = info.name.split(/\s+/)[0]?.toLowerCase();
    if (!firstWord) continue;
    const candidate = expansionsByPrefix.get(firstWord);
    if (candidate && candidate !== code) {
      map.set(code, candidate);
    }
  }

  return map;
}

// ---- Data model ----
export interface ScavCard { name: string; tag: string }
export interface ScavColorGroup { color: string; cards: ScavCard[] }
export interface ScavSet { code: string; name: string; released: string; colors: ScavColorGroup[] }
// For rares: flat alphabetical, no color subgroups
export interface ScavRareSet { code: string; name: string; released: string; cards: ScavCard[] }
export interface ScavData {
  deckName: string;
  commander: string;
  total: number;
  rareSets: ScavRareSet[];      // Rares & Mythics: set → flat alphabetical
  commonSets: ScavSet[];        // Commons & Uncommons: set → color → alphabetical
  multiples: { name: string; sets: string[] }[];
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
    } catch { /* skip */ }
  }
  return out;
}

function setNameOf(sets: SetIndex, code: string): string {
  return sets.get(code)?.name ?? code.toUpperCase();
}
function setReleasedOf(sets: SetIndex, code: string): string {
  return sets.get(code)?.released ?? "0000-00-00";
}

export async function buildScavengerData(deck: GeneratedDeck, deckName: string): Promise<ScavData> {
  const ids: { set: string; collector_number: string }[] = [];
  const entries: { name: string; set: string; collector: string; deckColors: string[]; deckType: string }[] = [];

  for (const card of deck.cards) {
    if (card.oracle_id.startsWith("basic:")) continue;
    const printings = card.printings ?? [];
    if (printings.length === 0) {
      entries.push({ name: card.name, set: "", collector: "", deckColors: card.color_identity, deckType: card.type_line });
      continue;
    }
    for (const p of printings) {
      if (!p.edition) continue;
      const set = p.edition.toLowerCase();
      const collector = p.collector_number ?? "";
      entries.push({ name: card.name, set, collector, deckColors: card.color_identity, deckType: card.type_line });
      if (collector) ids.push({ set, collector_number: collector });
    }
  }

  const [data, sets] = await Promise.all([fetchCardData(ids), loadSetIndex()]);
  const supersetMap = buildSupersetMap(sets);

  function superset(code: string): string {
    return supersetMap.get(code) ?? code;
  }

  // Track which supersets each card appears in (for multiples)
  const cardSupersets = new Map<string, Set<string>>();

  // rares: superset → card names (deduped)
  const raresBySet: Record<string, Map<string, ScavCard>> = {};
  // commons: superset → color → card names (deduped)
  const commonsBySet: Record<string, Record<string, Map<string, ScavCard>>> = {};

  for (const e of entries) {
    const d = data.get(`${e.set}:${e.collector}`);
    const colors = d ? d.colors : e.deckColors;
    const typeLine = d ? d.typeLine : e.deckType;
    const rarity = d?.rarity ?? "";
    const tag = rarity ? (RARITY_TAG[rarity] ?? "") : "";
    const ss = e.set ? superset(e.set) : "unknown";

    // Track for multiples
    if (e.set) {
      const s = cardSupersets.get(e.name) ?? new Set<string>();
      s.add(ss);
      cardSupersets.set(e.name, s);
    }

    if (isRare(rarity)) {
      const setCards = raresBySet[ss] ??= new Map();
      if (!setCards.has(e.name)) setCards.set(e.name, { name: e.name, tag });
    } else {
      const color = colorGroup(colors, typeLine);
      const setColors = commonsBySet[ss] ??= {};
      const colorCards = setColors[color] ??= new Map();
      if (!colorCards.has(e.name)) colorCards.set(e.name, { name: e.name, tag });
    }
  }

  // Build sorted rare sets
  const rareSetCodes = Object.keys(raresBySet).sort((a, b) => {
    const r = setReleasedOf(sets, b).localeCompare(setReleasedOf(sets, a));
    return r !== 0 ? r : setNameOf(sets, a).localeCompare(setNameOf(sets, b));
  });
  const rareSets: ScavRareSet[] = rareSetCodes.map((code) => ({
    code,
    name: setNameOf(sets, code),
    released: setReleasedOf(sets, code),
    cards: [...raresBySet[code].values()].sort((a, b) => a.name.localeCompare(b.name)),
  }));

  // Build sorted common sets with color subgroups
  const commonSetCodes = Object.keys(commonsBySet).sort((a, b) => {
    const r = setReleasedOf(sets, b).localeCompare(setReleasedOf(sets, a));
    return r !== 0 ? r : setNameOf(sets, a).localeCompare(setNameOf(sets, b));
  });
  const commonSets: ScavSet[] = commonSetCodes.map((code) => {
    const byColor = commonsBySet[code];
    const colorsPresent = COLOR_ORDER.filter((c) => byColor[c]).concat(
      Object.keys(byColor).filter((c) => !COLOR_ORDER.includes(c)),
    );
    return {
      code,
      name: setNameOf(sets, code),
      released: setReleasedOf(sets, code),
      colors: colorsPresent.map((color) => ({
        color,
        cards: [...byColor[color].values()].sort((a, b) => a.name.localeCompare(b.name)),
      })),
    };
  });

  // Multiples
  const multiples = [...cardSupersets.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([name, s]) => ({
      name,
      sets: [...s]
        .sort((a, b) => setReleasedOf(sets, b).localeCompare(setReleasedOf(sets, a)))
        .map((code) => setNameOf(sets, code)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { deckName, commander: deck.commander.name, total: deck.total, rareSets, commonSets, multiples };
}

// ---- PDF rendering ----

const M_LEFT = 36;
const M_RIGHT = 36;
const M_TOP = 40;
const M_BOTTOM = 36;
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const BOTTOM = PAGE_H - M_BOTTOM;

const COL_GAP = 12;
const NUM_COLS = 3;
const COL_W = (CONTENT_W - COL_GAP * (NUM_COLS - 1)) / NUM_COLS;

const CARD_LINE_H = 11;
const COLOR_HEADING_H = 12;
const SET_HEADING_H = 15;
const CB_SIZE = 6;
const CB_Y_OFFSET = -5;

interface Block {
  height: number;
  render: (doc: any, x: number, y: number) => void;
}

export async function downloadScavengerPdf(data: ScavData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  function txt(s: string, x: number, yy: number, size: number, style: "normal" | "bold", gray: number) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(gray);
    doc.text(s, x, yy);
  }
  function txtR(s: string, x: number, yy: number, size: number, gray: number) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(gray);
    doc.text(s, x, yy, { align: "right" });
  }
  function cb(x: number, yy: number) {
    doc.setDrawColor(140);
    doc.setLineWidth(0.5);
    doc.rect(x, yy + CB_Y_OFFSET, CB_SIZE, CB_SIZE);
  }
  function hr(x1: number, x2: number, yy: number) {
    doc.setDrawColor(180);
    doc.setLineWidth(0.5);
    doc.line(x1, yy, x2, yy);
  }

  // --- Build blocks for rares (flat per set) ---
  const rareBlocks: Block[] = [];
  for (const set of data.rareSets) {
    const h = SET_HEADING_H + set.cards.length * CARD_LINE_H;
    rareBlocks.push({
      height: h,
      render: (_d, x, yy) => {
        let cy = yy;
        txt(`${set.name} (${set.code.toUpperCase()})`, x, cy + 10, 8, "bold", 50);
        cy += SET_HEADING_H;
        for (const card of set.cards) {
          cb(x + 2, cy + 7);
          txt(card.name, x + 2 + CB_SIZE + 3, cy + 8, 8, "normal", 30);
          if (card.tag) txtR(card.tag, x + COL_W, cy + 8, 7, 160);
          cy += CARD_LINE_H;
        }
      },
    });
  }

  // --- Build blocks for commons (set → color → cards) ---
  const commonBlocks: Block[] = [];
  for (const set of data.commonSets) {
    let h = SET_HEADING_H;
    for (const cg of set.colors) {
      h += COLOR_HEADING_H + cg.cards.length * CARD_LINE_H;
    }
    commonBlocks.push({
      height: h,
      render: (_d, x, yy) => {
        let cy = yy;
        txt(`${set.name} (${set.code.toUpperCase()})`, x, cy + 10, 8, "bold", 50);
        cy += SET_HEADING_H;
        for (const cg of set.colors) {
          txt(cg.color, x + 2, cy + 8, 7, "bold", 110);
          cy += COLOR_HEADING_H;
          for (const card of cg.cards) {
            cb(x + 4, cy + 7);
            txt(card.name, x + 4 + CB_SIZE + 3, cy + 8, 8, "normal", 30);
            if (card.tag) txtR(card.tag, x + COL_W, cy + 8, 7, 160);
            cy += CARD_LINE_H;
          }
        }
      },
    });
  }

  // --- Build blocks for multiples ---
  const multiBlocks: Block[] = [];
  for (const m of data.multiples) {
    const setsLine = m.sets.join(", ");
    const charsPer = Math.floor(COL_W / 3.5);
    const lines = Math.max(1, Math.ceil(setsLine.length / charsPer));
    const h = CARD_LINE_H + lines * 9 + 2;
    multiBlocks.push({
      height: h,
      render: (_d, x, yy) => {
        cb(x, yy + 7);
        txt(m.name, x + CB_SIZE + 3, yy + 8, 8, "bold", 30);
        const wrapped = doc.splitTextToSize(setsLine, COL_W - 14) as string[];
        let ly = yy + CARD_LINE_H + 1;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(120);
        for (const line of wrapped) {
          doc.text(line, x + CB_SIZE + 3, ly);
          ly += 9;
        }
      },
    });
  }

  // --- Render: flow blocks into columns ---
  function flowSection(
    title: string,
    blocks: Block[],
    startY: number,
    startCol: number,
  ): { y: number; col: number } {
    let colY = startY;
    let colIdx = startCol;

    function colX() { return M_LEFT + colIdx * (COL_W + COL_GAP); }
    function nextCol() {
      colIdx++;
      if (colIdx >= NUM_COLS) {
        doc.addPage();
        colIdx = 0;
      }
      colY = M_TOP;
    }

    // Section heading (full width)
    if (colY > M_TOP + 4 || colIdx > 0) {
      // Start new page for each major section
      if (colIdx > 0 || colY > M_TOP + 20) {
        doc.addPage();
        colIdx = 0;
        colY = M_TOP;
      }
    }
    txt(title.toUpperCase(), M_LEFT, colY + 12, 10, "bold", 40);
    hr(M_LEFT, PAGE_W - M_RIGHT, colY + 16);
    colY += 24;

    for (const block of blocks) {
      if (colY + block.height > BOTTOM) nextCol();
      block.render(doc, colX(), colY);
      colY += block.height + 3;
    }

    return { y: colY, col: colIdx };
  }

  // --- Header ---
  txt("Scavenger List", M_LEFT, M_TOP + 14, 16, "bold", 20);
  txt(data.deckName, M_LEFT, M_TOP + 28, 10, "normal", 60);
  txt(
    `${data.commander}  ·  ${data.total} cards  ·  ${new Date().toLocaleDateString()}  ·  basic lands excluded`,
    M_LEFT, M_TOP + 40, 8, "normal", 120,
  );
  hr(M_LEFT, PAGE_W - M_RIGHT, M_TOP + 46);

  // Rares section
  if (rareBlocks.length > 0) {
    flowSection(RARES, rareBlocks, M_TOP + 56, 0);
  }

  // Commons section (new page)
  if (commonBlocks.length > 0) {
    flowSection(COMMONS, commonBlocks, M_TOP, 0);
  }

  // Multiples section (new page)
  if (multiBlocks.length > 0) {
    flowSection("Multiples — owned in 2+ sets", multiBlocks, M_TOP, 0);
  }

  // --- Page footers ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    txt(data.deckName, M_LEFT, PAGE_H - 22, 7, "normal", 170);
    txtR(`Page ${p} of ${totalPages}`, PAGE_W - M_RIGHT, PAGE_H - 22, 7, 170);
  }

  const safe = data.deckName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
  doc.save(`${safe}-scavenger-list.pdf`);
}
