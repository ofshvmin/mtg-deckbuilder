import type { DeckCard } from "./types";

// The cards a deck needs that you don't have, as a list Card Kingdom's deck
// builder and TCGplayer's Mass Entry both accept: one "N Card Name" per line.

export interface BuyLine {
  name: string;
  count: number;
}

/** Copies of this card you'd have to buy for the deck.
 *
 *  `ownershipKnown` is true for decks checked against the collection (imports,
 *  Explore). Elsewhere a card counts as missing only when the deck says so
 *  outright: every copy claimed by another deck (`short`), or no owned printing
 *  at all (`printings: []`, e.g. an upgrade bought into the deck). Older saved
 *  decks carry no printings, which must not read as "own none".
 */
export function missingCopies(card: DeckCard, ownershipKnown: boolean): number {
  if (isBasicLand(card)) return 0;
  if (card.short) return card.count;
  if (!card.printings) return ownershipKnown ? card.count : 0;
  const owned = card.printings.reduce((n, p) => n + (p.count || 0), 0);
  return Math.max(0, card.count - owned);
}

function isBasicLand(card: DeckCard): boolean {
  return card.oracle_id.startsWith("basic:") || /\bBasic\b.*\bLand\b/.test(card.type_line);
}

/** The name the stores list a card under.
 *
 *  Double-faced cards and adventures/omens are sold by their front face
 *  ("Delver of Secrets", "Bonecrusher Giant"); split cards keep both halves
 *  ("Fire // Ice"). A back-face image marks the double-faced ones.
 */
export function storeName(card: Pick<DeckCard, "name" | "type_line" | "image_uris_back">): string {
  if (!card.name.includes(" // ")) return card.name;
  if (card.image_uris_back || /\b(Adventure|Omen)\b/.test(card.type_line)) {
    return card.name.split(" // ")[0];
  }
  return card.name;
}

export function buyList(cards: DeckCard[], ownershipKnown: boolean): BuyLine[] {
  const byName = new Map<string, number>();
  for (const card of cards) {
    const n = missingCopies(card, ownershipKnown);
    if (n > 0) {
      const name = storeName(card);
      byName.set(name, (byName.get(name) ?? 0) + n);
    }
  }
  return [...byName]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buyListText(lines: BuyLine[]): string {
  return lines.map((l) => `${l.count} ${l.name}`).join("\n");
}
