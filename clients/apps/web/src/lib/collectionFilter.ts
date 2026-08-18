import type { CollectionCard, Color, Printing } from "@mtg/shared";
import { COLOR_ORDER } from "./format";

// Filtering and sorting the collection browser, kept as pure functions over the
// cards the API already sent. The whole collection arrives in one request, so
// none of this needs a round trip — the browser narrows what it's holding.
//
// Every field this reads is treated as optional. `colors`, `rarity`, `reserved`
// and `available_count` were added to /collection/cards after this UI shipped,
// and Vercel deploys on merge while Fly is deployed by hand — so for a window
// the frontend will be talking to a backend that doesn't send them. Filters over
// missing data must degrade to "don't narrow", never to "everything vanished".

export type ColorMode = "any" | "exact" | "atMost";
export type ColorSource = "identity" | "colors";
export type Availability = "owned" | "available";
export type Finish = "any" | "foil" | "nonfoil";

export interface FilterState {
  /** Matches name, type line, and oracle text. */
  q: string;
  /** Set codes, lowercase. A card matches if any owned printing is from one. */
  sets: string[];
  colors: Color[];
  /** Treat "no colors" as a selectable value alongside W/U/B/R/G. */
  colorless: boolean;
  colorMode: ColorMode;
  colorSource: ColorSource;
  types: string[];
  rarities: string[];
  cmcMin: number | null;
  cmcMax: number | null;
  finish: Finish;
  availability: Availability;
  minCopies: number | null;
  reservedOnly: boolean;
  gameChangersOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  q: "",
  sets: [],
  colors: [],
  colorless: false,
  colorMode: "any",
  colorSource: "identity",
  types: [],
  rarities: [],
  cmcMin: null,
  cmcMax: null,
  finish: "any",
  availability: "owned",
  minCopies: null,
  reservedOnly: false,
  gameChangersOnly: false,
};

export type SortKey =
  | "name" | "cmc" | "copies" | "value" | "added" | "color" | "type" | "set" | "rarity";
export type SortDir = "asc" | "desc";

export const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  cmc: "Mana value",
  copies: "Copies owned",
  value: "Value",
  added: "Recently added",
  color: "Color",
  type: "Type",
  set: "Set",
  rarity: "Rarity",
};

/** Sane starting direction per key: names read A–Z, money reads big-first. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: "asc", cmc: "asc", copies: "desc", value: "desc", added: "desc",
  color: "asc", type: "asc", set: "asc", rarity: "desc",
};

// ---- card facts ----

// Supertypes aren't card types — "Legendary Creature" is a Creature. Stripping
// them keeps the type filter to the eight things people actually sort by.
const SUPERTYPES = new Set(["legendary", "basic", "snow", "world", "ongoing", "elite", "host"]);

export const CARD_TYPES = [
  "Creature", "Instant", "Sorcery", "Artifact",
  "Enchantment", "Planeswalker", "Land", "Battle",
] as const;

/**
 * The card types on a type line: "Legendary Creature — Human Cleric" → ["Creature"].
 *
 * Split and modal cards carry both faces ("Instant // Sorcery"), so each side is
 * read and the results unioned — a Fire // Ice is findable as either.
 */
export function cardTypes(typeLine: string): string[] {
  const found = new Set<string>();
  for (const face of typeLine.split("//")) {
    for (const word of face.split("—")[0].trim().split(/\s+/)) {
      const lower = word.toLowerCase();
      if (!word || SUPERTYPES.has(lower)) continue;
      const match = CARD_TYPES.find((t) => t.toLowerCase() === lower);
      if (match) found.add(match);
    }
  }
  return [...found];
}

const RARITY_RANK: Record<string, number> = {
  common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 4,
};

/** The four printed rarities, plus one bucket for Scryfall's `special`/`bonus`. */
export const RARITIES = ["common", "uncommon", "rare", "mythic", "special"] as const;

/** Fold Scryfall's `bonus` in with `special` — 72 cards total isn't worth two chips. */
export function rarityBucket(rarity?: string | null): string | null {
  if (!rarity) return null;
  return rarity === "bonus" ? "special" : rarity;
}

/** What one printing is worth per copy: its finish's market price. */
function unitPrice(p: Printing): number {
  const market = p.finish === "foil" ? (p.price_usd_foil ?? p.price_usd) : p.price_usd;
  return market ?? p.purchase_price ?? 0;
}

/** Total market value of every copy owned, across printings. */
export function cardValue(card: CollectionCard): number {
  return (card.printings ?? []).reduce((sum, p) => sum + unitPrice(p) * (p.count || 0), 0);
}

/**
 * Copies not committed to a deck marked in use.
 *
 * Falls back to copies owned when the backend hasn't been deployed yet: an
 * un-upgraded server sends no `available_count`, and reading that as zero would
 * empty the table the moment someone picked "Available only".
 */
export function availableCopies(card: CollectionCard): number {
  return card.available_count ?? card.total_count;
}

/** Newest `added_at` across printings; "" for collections imported before it existed. */
export function addedAt(card: CollectionCard): string {
  let newest = "";
  for (const p of card.printings ?? []) {
    if (p.added_at && p.added_at > newest) newest = p.added_at;
  }
  return newest;
}

/** Color identity, or the card's own colors — whichever the filter is reading. */
function colorsOf(card: CollectionCard, source: ColorSource): Color[] {
  if (source === "colors") return card.colors ?? card.color_identity ?? [];
  return card.color_identity ?? [];
}

// ---- filtering ----

function matchesColors(card: CollectionCard, f: FilterState): boolean {
  if (f.colors.length === 0 && !f.colorless) return true;
  const own = colorsOf(card, f.colorSource);
  const selected = new Set(f.colors);

  if (f.colorMode === "exact") {
    // Colorless is only "exactly colorless" when nothing else is picked.
    if (f.colorless && f.colors.length === 0) return own.length === 0;
    return own.length === selected.size && own.every((c) => selected.has(c));
  }
  if (f.colorMode === "atMost") {
    // "What fits in these colors" — the deck-building question. Colorless cards
    // go in any deck, so they always pass.
    return own.every((c) => selected.has(c));
  }
  if (own.length === 0) return f.colorless;
  return own.some((c) => selected.has(c));
}

function matchesText(card: CollectionCard, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    card.name.toLowerCase().includes(needle) ||
    (card.type_line ?? "").toLowerCase().includes(needle) ||
    (card.oracle_text ?? "").toLowerCase().includes(needle)
  );
}

export function filterCards(cards: CollectionCard[], f: FilterState): CollectionCard[] {
  const sets = new Set(f.sets);
  const types = new Set(f.types);
  const rarities = new Set(f.rarities);

  return cards.filter((card) => {
    if (!matchesText(card, f.q)) return false;
    if (!matchesColors(card, f)) return false;

    if (sets.size > 0) {
      const owned = (card.printings ?? []).some((p) => sets.has((p.edition ?? "").toLowerCase()));
      if (!owned) return false;
    }
    if (types.size > 0 && !cardTypes(card.type_line ?? "").some((t) => types.has(t))) return false;
    if (rarities.size > 0) {
      const bucket = rarityBucket(card.rarity);
      // Cards synced before `rarity` existed have none. Excluding them would be a
      // silent lie about the collection, so they only drop out when a rarity is asked for.
      if (!bucket || !rarities.has(bucket)) return false;
    }

    if (f.cmcMin !== null && card.cmc < f.cmcMin) return false;
    if (f.cmcMax !== null && card.cmc > f.cmcMax) return false;

    if (f.finish !== "any") {
      const has = (card.printings ?? []).some((p) => p.finish === f.finish && (p.count || 0) > 0);
      if (!has) return false;
    }
    if (f.availability === "available" && availableCopies(card) <= 0) return false;
    if (f.minCopies !== null && card.total_count < f.minCopies) return false;
    if (f.reservedOnly && !card.reserved) return false;
    if (f.gameChangersOnly && !card.game_changer) return false;

    return true;
  });
}

export function isFiltered(f: FilterState): boolean {
  return (
    f.q.trim() !== "" || f.sets.length > 0 || f.colors.length > 0 || f.colorless ||
    f.types.length > 0 || f.rarities.length > 0 || f.cmcMin !== null || f.cmcMax !== null ||
    f.finish !== "any" || f.availability !== "owned" || f.minCopies !== null ||
    f.reservedOnly || f.gameChangersOnly
  );
}

// ---- sorting ----

/** Colors as a sortable rank: colorless last, then WUBRG, then multicolor by size. */
function colorRank(card: CollectionCard): number {
  const own = card.color_identity ?? [];
  if (own.length === 0) return 99;
  if (own.length > 1) return 10 + own.length;
  return COLOR_ORDER.indexOf(own[0]);
}

/** The set a card is filed under: its earliest owned printing, alphabetically. */
function primarySet(card: CollectionCard): string {
  const codes = (card.printings ?? [])
    .map((p) => (p.edition ?? "").toLowerCase())
    .filter(Boolean)
    .sort();
  return codes[0] ?? "";
}

function compare(a: CollectionCard, b: CollectionCard, key: SortKey): number {
  switch (key) {
    case "cmc": return a.cmc - b.cmc;
    case "copies": return a.total_count - b.total_count;
    case "value": return cardValue(a) - cardValue(b);
    case "added": return addedAt(a).localeCompare(addedAt(b));
    case "color": return colorRank(a) - colorRank(b);
    case "type": return (cardTypes(a.type_line)[0] ?? "").localeCompare(cardTypes(b.type_line)[0] ?? "");
    case "set": return primarySet(a).localeCompare(primarySet(b));
    case "rarity": return (RARITY_RANK[a.rarity ?? ""] ?? -1) - (RARITY_RANK[b.rarity ?? ""] ?? -1);
    default: return 0;
  }
}

export function sortCards(cards: CollectionCard[], key: SortKey, dir: SortDir): CollectionCard[] {
  const sign = dir === "asc" ? 1 : -1;
  // Name breaks every tie, so equal mana values stay alphabetical rather than
  // shuffling on each re-render.
  return [...cards].sort((a, b) => {
    const primary = compare(a, b, key);
    if (primary !== 0) return primary * sign;
    return a.name.localeCompare(b.name);
  });
}

// ---- URL round-trip ----

// Filters live in the query string so the back button works and a narrowed view
// can be pasted to someone. Only non-default values are written, keeping a plain
// collection view at a clean /collection.

export function toSearchParams(f: FilterState, sort: SortKey, dir: SortDir): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.sets.length) p.set("sets", f.sets.join(","));
  if (f.colors.length) p.set("colors", f.colors.join(""));
  if (f.colorless) p.set("c", "1");
  if (f.colorMode !== "any") p.set("cmode", f.colorMode);
  if (f.colorSource !== "identity") p.set("csrc", f.colorSource);
  if (f.types.length) p.set("types", f.types.join(","));
  if (f.rarities.length) p.set("rarity", f.rarities.join(","));
  if (f.cmcMin !== null) p.set("mvmin", String(f.cmcMin));
  if (f.cmcMax !== null) p.set("mvmax", String(f.cmcMax));
  if (f.finish !== "any") p.set("finish", f.finish);
  if (f.availability !== "owned") p.set("avail", f.availability);
  if (f.minCopies !== null) p.set("copies", String(f.minCopies));
  if (f.reservedOnly) p.set("reserved", "1");
  if (f.gameChangersOnly) p.set("gc", "1");
  if (sort !== "name") p.set("sort", sort);
  if (dir !== DEFAULT_DIR[sort]) p.set("dir", dir);
  return p;
}

function num(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function list(raw: string | null): string[] {
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function fromSearchParams(
  p: URLSearchParams,
): { filters: FilterState; sort: SortKey; dir: SortDir } {
  const sort = oneOf(p.get("sort"), Object.keys(SORT_LABELS) as SortKey[], "name");
  const filters: FilterState = {
    q: p.get("q") ?? "",
    sets: list(p.get("sets")).map((s) => s.toLowerCase()),
    colors: (p.get("colors") ?? "").split("").filter((c): c is Color =>
      COLOR_ORDER.includes(c as Color)),
    colorless: p.get("c") === "1",
    colorMode: oneOf(p.get("cmode"), ["any", "exact", "atMost"] as const, "any"),
    colorSource: oneOf(p.get("csrc"), ["identity", "colors"] as const, "identity"),
    types: list(p.get("types")).filter((t) => (CARD_TYPES as readonly string[]).includes(t)),
    rarities: list(p.get("rarity")).filter((r) => (RARITIES as readonly string[]).includes(r)),
    cmcMin: num(p.get("mvmin")),
    cmcMax: num(p.get("mvmax")),
    finish: oneOf(p.get("finish"), ["any", "foil", "nonfoil"] as const, "any"),
    availability: oneOf(p.get("avail"), ["owned", "available"] as const, "owned"),
    minCopies: num(p.get("copies")),
    reservedOnly: p.get("reserved") === "1",
    gameChangersOnly: p.get("gc") === "1",
  };
  return { filters, sort, dir: oneOf(p.get("dir"), ["asc", "desc"] as const, DEFAULT_DIR[sort]) };
}
