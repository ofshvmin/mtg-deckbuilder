// Build a "scavenger list": a pull-guide + checklist for a deck — which cards
// to fetch from which part of the collection. The web renders it as a printable
// PDF, the iOS app as a checklist screen.
// Two sections: Rares & Mythics (flat alphabetical per set), then Commons &
// Uncommons (grouped set → color → alphabetical). Sets are merged into their
// "superset" — same parent_set_code, or same product family by name prefix.
// Multi-column layout to minimize pages.
import type { GeneratedDeck } from "./types";

/** One set from Scryfall's catalog, keyed by lowercase code in a SetIndex. Each
 *  app loads and caches the catalog its own way (localStorage on web, a cache
 *  file on mobile) and hands it in. */
export interface SetInfo {
  name: string;
  iconSvgUri: string;
  released?: string; // ISO date, for ordering sets newest-first
  parentCode?: string; // parent set code (e.g. "eoe" for "eoc")
}

export type SetIndex = Map<string, SetInfo>;

const COLOR_ORDER = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless", "Lands"];
const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const RARITY_TAG: Record<string, string> = { mythic: "M", rare: "R", uncommon: "U", common: "C", special: "S", bonus: "S" };

/** Section titles, shared so the PDF and the app label them alike. */
export const RARES = "Rares & Mythics";
export const COMMONS = "Commons & Uncommons";

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

type ScryfallIdentifier = { set: string; collector_number: string } | { name: string };

async function fetchCardData(ids: ScryfallIdentifier[]): Promise<Map<string, CardData>> {
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
        const d: CardData = {
          rarity: c.rarity ?? "",
          colors: c.colors ?? c.card_faces?.[0]?.colors ?? [],
          typeLine: c.type_line ?? "",
        };
        // Key by set:collector when available, and always by name for fallback
        out.set(`${c.set}:${c.collector_number}`, d);
        if (c.name) out.set(`name:${c.name.toLowerCase()}`, d);
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

export async function buildScavengerData(
  deck: GeneratedDeck,
  deckName: string,
  sets: SetIndex,
): Promise<ScavData> {
  const ids: ScryfallIdentifier[] = [];
  const namesSent = new Set<string>(); // avoid duplicate name lookups
  const entries: { name: string; set: string; collector: string; deckColors: string[]; deckType: string }[] = [];

  for (const card of deck.cards) {
    if (card.oracle_id.startsWith("basic:")) continue;
    const printings = card.printings ?? [];
    if (printings.length === 0) {
      entries.push({ name: card.name, set: "", collector: "", deckColors: card.color_identity, deckType: card.type_line });
      // Look up by name so we at least get rarity
      if (!namesSent.has(card.name.toLowerCase())) {
        ids.push({ name: card.name });
        namesSent.add(card.name.toLowerCase());
      }
      continue;
    }
    for (const p of printings) {
      if (!p.edition) continue;
      const set = p.edition.toLowerCase();
      const collector = p.collector_number ?? "";
      entries.push({ name: card.name, set, collector, deckColors: card.color_identity, deckType: card.type_line });
      if (collector) {
        ids.push({ set, collector_number: collector });
      } else if (!namesSent.has(card.name.toLowerCase())) {
        // No collector # — fall back to name lookup for rarity
        ids.push({ name: card.name });
        namesSent.add(card.name.toLowerCase());
      }
    }
  }

  const data = await fetchCardData(ids);
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
    // Try set:collector first, then fall back to name lookup
    const d = data.get(`${e.set}:${e.collector}`) ?? data.get(`name:${e.name.toLowerCase()}`);
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

  return { deckName, commander: deck.commander?.name ?? "", total: deck.total, rareSets, commonSets, multiples };
}
