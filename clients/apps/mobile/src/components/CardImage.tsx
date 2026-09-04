import { Image, type ImageContentPosition } from "expo-image";
import { Text } from "react-native";
import type { Printing } from "@mtg/shared";

// Scryfall art_crops are 626×457 (~1.37:1); the deck banners are ~3:1, so cover
// shows only the middle ~44% of the art's height. Centered, that reliably
// decapitates the subject — MTG illustrations put the face and the action in
// roughly the top third, not the middle. Biasing to 30% (CSS object-position
// `50% 30%`) shifts the visible band to ~13–58% of the art, which frames the
// subject on art that was previously cut off without pushing the well-centered
// pieces off the top. Checked against real art crops rather than guessed.
const ART_FOCUS: ImageContentPosition = { top: "30%", left: "50%" };

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

// Scryfall's image policy only permits an art_crop where the illustrator is
// credited in the same interface, so the art and the credit arrive together from
// the API (see card_prints.art_by_name) and render as a pair. Without credited
// art we render nothing and let the caller's background show through — which
// also keeps us off the rate-limited api.scryfall.com image endpoint.
export function CommanderArtImage({
  name,
  className = "",
  style,
  artCropUrl,
  artist,
  contentPosition = ART_FOCUS,
}: {
  name: string;
  className?: string;
  style?: object;
  /** Override the default top-biased focus for an unusually composed banner. */
  contentPosition?: ImageContentPosition;
  // Required, not optional: this renders nothing without a url, so an omitted
  // prop is a silently blank banner. Making it explicit means the compiler
  // catches a caller that forgets it — which is how the Decks tab shipped with
  // no art at all. `artist` rides along because Scryfall's image policy wants
  // the credit wherever an art_crop is shown.
  artCropUrl: string | null | undefined;
  artist: string | null | undefined;
}) {
  if (!artCropUrl) return null;
  return (
    <>
      <Image
        source={{ uri: artCropUrl }}
        contentFit="cover"
        contentPosition={contentPosition}
        transition={300}
        className={className}
        style={style}
        cachePolicy="disk"
        accessibilityLabel={artist ? `${name}, illustrated by ${artist}` : name}
      />
      {artist ? (
        <Text
          numberOfLines={1}
          style={{
            position: "absolute",
            right: 4,
            bottom: 2,
            maxWidth: "55%",
            fontSize: 9,
            lineHeight: 11,
            color: "rgba(255,255,255,0.7)",
            // The caller paints a scrim over the art after this component
            // renders; the credit has to stay legible above it.
            zIndex: 2,
          }}
        >
          {artist}
        </Text>
      ) : null}
    </>
  );
}
