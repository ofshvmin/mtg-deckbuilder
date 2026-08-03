import { Image } from "expo-image";
import type { Printing } from "@mtg/shared";

type Size = "small" | "normal" | "large" | "art_crop";

function scryfallUrl(printing: Printing | undefined, name: string, size: Size = "normal"): string {
  if (printing?.edition && printing.collector_number) {
    const set = encodeURIComponent(printing.edition.toLowerCase());
    const cn = encodeURIComponent(printing.collector_number);
    return `https://api.scryfall.com/cards/${set}/${cn}?format=image&version=${size}`;
  }
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${size}`;
}

function resolveUri(
  printing: Printing | undefined,
  name: string,
  size: Size,
  imageUrl?: string,
): string {
  if (imageUrl) return imageUrl;
  // The backend already enriches printings with real Scryfall CDN URLs
  // (card_prints.image_uris). Those paths are UUID-sharded, so they can't be
  // derived from set + collector number — always prefer what we were given.
  const fromPrinting = printing?.image_uris?.[size];
  if (fromPrinting) return fromPrinting;
  return scryfallUrl(printing, name, size);
}

export default function CardImage({
  name,
  printing,
  size = "normal",
  className = "",
  style,
  imageUrl,
}: {
  name: string;
  printing?: Printing;
  size?: Size;
  className?: string;
  style?: object;
  imageUrl?: string;
}) {
  return (
    <Image
      source={{ uri: resolveUri(printing, name, size, imageUrl) }}
      contentFit="contain"
      transition={200}
      className={className}
      style={[{ aspectRatio: 745 / 1040 }, style]}
      placeholder={{ uri: undefined }}
      cachePolicy="disk"
    />
  );
}

export function CommanderArtImage({
  name,
  className = "",
  style,
  artCropUrl,
}: {
  name: string;
  className?: string;
  style?: object;
  artCropUrl?: string;
}) {
  const uri = artCropUrl || `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=art_crop`;
  return (
    <Image
      source={{ uri }}
      contentFit="cover"
      transition={300}
      className={className}
      style={style}
      cachePolicy="disk"
    />
  );
}
