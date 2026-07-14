import type { Printing } from "@mtg/shared";

// Card images aren't stored in our DB (we deferred the printing catalog). Each
// owned printing has a set code + collector number, so we resolve the exact
// printing straight from Scryfall's image endpoint. For DFCs/MDFCs the `face`
// param selects front or back. Foil distinction is handled purely in CSS (the
// card face artwork is identical — Scryfall doesn't serve separate foil images).

export type ScryfallImageSize = "small" | "normal" | "large" | "png" | "art_crop";
export type CardFace = "front" | "back";

/** Image URL for a specific owned printing (set/collector), or name fallback. */
export function scryfallImageUrl(
  printing: Printing | undefined,
  cardName: string,
  size: ScryfallImageSize = "normal",
  face: CardFace = "front",
): string {
  if (printing?.edition && printing.collector_number) {
    const set = encodeURIComponent(printing.edition.toLowerCase());
    const cn = encodeURIComponent(printing.collector_number);
    const faceParam = face === "back" ? "&face=back" : "";
    return `https://api.scryfall.com/cards/${set}/${cn}?format=image&version=${size}${faceParam}`;
  }
  if (printing?.edition) {
    return scryfallSetNamedImageUrl(cardName, printing.edition, size, face);
  }
  return scryfallNamedImageUrl(cardName, size, face);
}

/** Named lookup constrained to a specific set (for printings missing collector_number). */
export function scryfallSetNamedImageUrl(
  cardName: string,
  set: string,
  size: ScryfallImageSize = "normal",
  face: CardFace = "front",
): string {
  const faceParam = face === "back" ? "&face=back" : "";
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
    cardName,
  )}&set=${encodeURIComponent(set.toLowerCase())}&format=image&version=${size}${faceParam}`;
}

/** Fallback: a representative image looked up by exact card name. */
export function scryfallNamedImageUrl(
  cardName: string,
  size: ScryfallImageSize = "normal",
  face: CardFace = "front",
): string {
  const faceParam = face === "back" ? "&face=back" : "";
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
    cardName,
  )}&format=image&version=${size}${faceParam}`;
}

/** Deterministic CDN URL for a printing (not rate-limited, unlike the API). */
export function cdnImageUrl(
  set: string,
  cn: string,
  size: ScryfallImageSize = "normal",
  face: CardFace = "front",
): string {
  return `https://cards.scryfall.io/${size}/${face}/${set.toLowerCase()}/${cn}.jpg`;
}

/** Heuristic: does this card have two faces (MDFC, transform, etc.)? */
export function isDfc(typeLine?: string, manaCost?: string): boolean {
  return (typeLine?.includes(" // ") || manaCost?.includes(" // ")) ?? false;
}
