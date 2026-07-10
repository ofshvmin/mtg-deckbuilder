import type { Printing } from "@mtg/shared";

// Card images aren't stored in our DB (we deferred the printing catalog). But
// each owned printing has a set code + collector number, so we render the exact
// printing straight from Scryfall's image endpoint, falling back to a name
// lookup when a collector number is missing. Images are only requested in the
// detail modal (a handful at a time), which keeps us within Scryfall's etiquette.

export type ScryfallImageSize = "small" | "normal" | "large" | "png" | "art_crop";

/** Image URL for a specific owned printing (set/collector), or name fallback. */
export function scryfallImageUrl(
  printing: Printing | undefined,
  cardName: string,
  size: ScryfallImageSize = "normal",
): string {
  if (printing?.edition && printing.collector_number) {
    const set = encodeURIComponent(printing.edition.toLowerCase());
    const cn = encodeURIComponent(printing.collector_number);
    return `https://api.scryfall.com/cards/${set}/${cn}?format=image&version=${size}`;
  }
  return scryfallNamedImageUrl(cardName, size);
}

/** Fallback: a representative image looked up by exact card name. */
export function scryfallNamedImageUrl(
  cardName: string,
  size: ScryfallImageSize = "normal",
): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
    cardName,
  )}&format=image&version=${size}`;
}
