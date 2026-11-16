import type { EdhrecDeckPreview } from "./types";

/** An EDHREC preview's "1 Sol Ring" lines as the card list `resolveExternalDeck`
 *  takes, flagging the commanders. Shared so web and iOS read decks alike. */
export function edhrecPreviewCards(
  preview: EdhrecDeckPreview,
): { name: string; quantity: number; is_commander: boolean }[] {
  const commanders = new Set(preview.commanders ?? []);
  return (preview.deck ?? [])
    .filter((line) => line?.trim())
    .map((line) => {
      const first = line.trim().split(" ", 2);
      const quantity = parseInt(first[0], 10) || 1;
      const name = line.trim().substring(first[0].length).trim();
      return { name, quantity, is_commander: commanders.has(name) };
    })
    .filter((c) => c.name);
}
