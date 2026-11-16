import type { EdhrecDeckPreview } from "./types";

type ResolveCard = { name: string; quantity: number; is_commander: boolean };

/** An EDHREC preview as the card list `resolveExternalDeck` takes, flagging the
 *  commanders. Shared so web and iOS read decks alike.
 *
 *  EDHREC has sent two shapes: a list of "1 Sol Ring" lines (with commanders in
 *  a separate field), and — since late 2026 — sections: `{commander_v2: [[name,
 *  qty]], cards: {Sorcery: [[name, qty]], …}}`. Both are read; an empty result
 *  means the deck couldn't be read at all. */
export function edhrecPreviewCards(preview: EdhrecDeckPreview): ResolveCard[] {
  const deck = preview.deck;
  if (Array.isArray(deck)) {
    const commanders = new Set(preview.commanders ?? []);
    return deck
      .filter((line) => line?.trim())
      .map((line) => {
        const first = line.trim().split(" ", 2);
        const quantity = parseInt(first[0], 10) || 1;
        const name = line.trim().substring(first[0].length).trim();
        return { name, quantity, is_commander: commanders.has(name) };
      })
      .filter((c) => c.name);
  }
  if (!deck || typeof deck !== "object") return [];

  const commanderPairs: [string, number][] =
    deck.commander_v2 ?? (deck.commander ?? preview.commanders ?? []).map((n) => [n, 1]);
  const out: ResolveCard[] = commanderPairs
    .filter(([name]) => name)
    .map(([name, qty]) => ({ name, quantity: qty || 1, is_commander: true }));
  for (const group of Object.values(deck.cards ?? {})) {
    for (const [name, qty] of group ?? []) {
      if (name) out.push({ name, quantity: qty || 1, is_commander: false });
    }
  }
  return out;
}
