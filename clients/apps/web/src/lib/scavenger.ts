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

  const colX = () => ML + col * (COL_W + COL_GAP);

  function need(h: number) {
    if (cy + h <= USABLE_BOTTOM) return; // fits
    col++;
    if (col >= COLS) { doc.addPage(); col = 0; }
    cy = MT;
  }

  function freshPage() {
    if (col !== 0 || cy !== MT) { doc.addPage(); col = 0; cy = MT; }
  }

  // ---- page 1 header ----
  t("Scavenger List", ML, cy + 14, 16, true, 20);
  t(data.deckName, ML, cy + 28, 10, false, 60);
  t(
    `${data.commander}  ·  ${data.total} cards  ·  ${new Date().toLocaleDateString()}  ·  basic lands excluded`,
    ML, cy + 40, 8, false, 120,
  );
  rule(cy + 46);
  cy += 56;

  // ---- RARES & MYTHICS (flat alphabetical per set) ----
  if (data.rareSets.length) {
    t(RARES.toUpperCase(), ML, cy + 11, 10, true, 40);
    rule(cy + 15);
    cy += 24;

    for (const set of data.rareSets) {
      const h = SET_H + set.cards.length * LINE;
      need(Math.min(h, SET_H + 3 * LINE)); // keep heading + at least 3 cards
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
    freshPage();
    t(COMMONS.toUpperCase(), ML, cy + 11, 10, true, 40);
    rule(cy + 15);
    cy += 24;

    for (const set of data.commonSets) {
      need(SET_H + COLOR_H + LINE); // heading + at least one color + one card
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
    freshPage();
    t("MULTIPLES — OWNED IN 2+ SETS", ML, cy + 11, 10, true, 40);
    rule(cy + 15);
    cy += 24;

    for (const m of data.multiples) {
      // Pre-measure: wrap the sets line to know exact height
      doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      const setsStr = m.sets.join(", ");
      const wrapped = doc.splitTextToSize(setsStr, COL_W - CB - 6) as string[];
      const h = LINE + wrapped.length * 9 + 4;

      need(h);
      box(colX(), cy + 7);
      t(m.name, colX() + CB + 3, cy + 8, 8, true, 30);
      cy += LINE;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120);
      for (const line of wrapped) {
        doc.text(line, colX() + CB + 3, cy);
        cy += 9;
      }
      cy += 4;
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
