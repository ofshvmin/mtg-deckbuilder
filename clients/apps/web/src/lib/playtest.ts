// Pure goldfish-simulation helpers. Operate on a deck's card list entirely
// client-side — no backend. Colors aren't simulated; "mana" = lands in play,
// which is enough to get a feel for a deck's opening consistency.
import type { DeckCard } from "@mtg/shared";

export interface LibCard {
  uid: string; // unique per physical copy (deck is singleton except basics)
  oracle_id: string;
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  isLand: boolean;
  isCreature: boolean;
  etbTapped: boolean; // land enters tapped
}

function cardIsLand(c: DeckCard): boolean {
  return c.slot === "land" || /\bLand\b/.test(c.type_line);
}

function cardIsCreature(c: DeckCard): boolean {
  return /\bCreature\b/i.test(c.type_line);
}

function cardEtbTapped(c: DeckCard): boolean {
  // Heuristic: lands that say "enters the battlefield tapped" or "enters tapped"
  const text = (c as any).oracle_text ?? "";
  return /enters the battlefield tapped|enters tapped/i.test(text);
}

/** Expand a deck's cards into a flat library (one entry per physical copy). */
export function buildLibrary(cards: DeckCard[]): LibCard[] {
  const lib: LibCard[] = [];
  for (const c of cards) {
    const n = c.count ?? 1;
    const isLand = cardIsLand(c);
    const isCreature = cardIsCreature(c);
    const etbTapped = isLand && cardEtbTapped(c);
    for (let i = 0; i < n; i++) {
      lib.push({
        uid: `${c.oracle_id}#${i}`,
        oracle_id: c.oracle_id,
        name: c.name,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
        type_line: c.type_line,
        isLand,
        isCreature,
        etbTapped,
      });
    }
  }
  return lib;
}

/** Fisher-Yates shuffle into a new array. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface OpenerStats {
  iterations: number;
  avgLands: number;
  keepablePct: number; // 2-5 lands
  screwPct: number; // 0-1 lands
  floodPct: number; // 6-7 lands
  landDist: number[]; // fraction of hands, index 0..7 = that many lands
}

/** Monte-Carlo the opening 7 to gauge land consistency. */
export function sampleOpenerStats(cards: DeckCard[], iterations = 1000): OpenerStats {
  const lib = buildLibrary(cards);
  const size = lib.length;
  const dist = new Array(8).fill(0);
  let totalLands = 0;

  for (let it = 0; it < iterations; it++) {
    // Partial Fisher-Yates: only the first 7 positions need to be settled.
    const a = lib.slice();
    let lands = 0;
    const draws = Math.min(7, size);
    for (let i = 0; i < draws; i++) {
      const j = i + Math.floor(Math.random() * (size - i));
      [a[i], a[j]] = [a[j], a[i]];
      if (a[i].isLand) lands++;
    }
    dist[lands]++;
    totalLands += lands;
  }

  const landDist = dist.map((d) => d / iterations);
  const pct = (from: number, to: number) =>
    (dist.slice(from, to + 1).reduce((s, d) => s + d, 0) / iterations) * 100;

  return {
    iterations,
    avgLands: totalLands / iterations,
    keepablePct: pct(2, 5),
    screwPct: pct(0, 1),
    floodPct: pct(6, 7),
    landDist,
  };
}
