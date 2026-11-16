import type { DeckCard, GeneratedDeck } from "./types";

// Two decks side by side: which cards they share and which are unique to each.
// Pure, so the web's Compare page and the iOS compare sheet split identically.

export const SLOT_LABELS: Record<string, string> = {
  land: "Lands",
  ramp: "Ramp",
  card_draw: "Card Draw",
  removal: "Removal",
  board_wipe: "Board Wipes",
  game_plan: "Game Plan",
};

export const SLOT_ORDER = ["land", "ramp", "card_draw", "removal", "board_wipe", "game_plan"];

export interface ComparedCard {
  oracle_id: string;
  name: string;
  slot: string;
  countA?: number;
  countB?: number;
}

export function compareDeckCards(a: GeneratedDeck, b: GeneratedDeck) {
  const mapA = new Map<string, DeckCard>();
  for (const c of a.cards) mapA.set(c.oracle_id, c);
  const mapB = new Map<string, DeckCard>();
  for (const c of b.cards) mapB.set(c.oracle_id, c);

  const shared: ComparedCard[] = [];
  const onlyA: ComparedCard[] = [];
  const onlyB: ComparedCard[] = [];
  for (const [id, card] of mapA) {
    const other = mapB.get(id);
    if (other) {
      shared.push({ oracle_id: id, name: card.name, slot: card.slot, countA: card.count, countB: other.count });
    } else {
      onlyA.push({ oracle_id: id, name: card.name, slot: card.slot, countA: card.count });
    }
  }
  for (const [id, card] of mapB) {
    if (!mapA.has(id)) onlyB.push({ oracle_id: id, name: card.name, slot: card.slot, countB: card.count });
  }
  return { shared, onlyA, onlyB };
}

/** Cards grouped by role in slot order, each group alphabetical; empty roles omitted. */
export function groupBySlot(cards: ComparedCard[]): { slot: string; label: string; cards: ComparedCard[] }[] {
  const groups = new Map<string, ComparedCard[]>();
  for (const c of cards) groups.set(c.slot, [...(groups.get(c.slot) ?? []), c]);
  const known = SLOT_ORDER.filter((s) => groups.has(s));
  const other = [...groups.keys()].filter((s) => !SLOT_ORDER.includes(s));
  return [...known, ...other].map((slot) => ({
    slot,
    label: SLOT_LABELS[slot] ?? slot,
    cards: [...groups.get(slot)!].sort((x, y) => x.name.localeCompare(y.name)),
  }));
}
