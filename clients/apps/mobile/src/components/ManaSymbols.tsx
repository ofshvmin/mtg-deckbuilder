import { View } from "react-native";
import { Image } from "expo-image";
import { orderColors, type Color } from "@mtg/shared";

// Mana symbols as Scryfall's card-symbol SVGs — the same artwork the web app
// gets from mana-font, without embedding a font in the binary. expo-image
// caches them, so each symbol is fetched once.

/** "{U/P}" inner text → Scryfall's file name: slashes collapse, "U/P" → "UP". */
function symbolUri(inner: string): string {
  const s = inner.trim().toUpperCase().replace(/\//g, "");
  return `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(s)}.svg`;
}

export function ManaSymbol({ symbol, size = 16 }: { symbol: string; size?: number }) {
  return (
    <Image
      source={{ uri: symbolUri(symbol) }}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessibilityLabel={symbol}
    />
  );
}

/** A color identity as symbols; no colors shows the colorless symbol. */
export function ColorPips({ colors, size = 16 }: { colors: Color[]; size?: number }) {
  const ordered = orderColors(colors);
  const symbols = ordered.length ? ordered : ["C"];
  return (
    <View className="flex-row items-center" style={{ gap: 2 }}>
      {symbols.map((s) => (
        <ManaSymbol key={s} symbol={s} size={size} />
      ))}
    </View>
  );
}

/** A mana cost like "{2}{W}{U/P}"; nothing for an empty cost. */
export function ManaCost({ cost, size = 14 }: { cost: string; size?: number }) {
  const symbols = cost.match(/\{([^}]+)\}/g);
  if (!symbols?.length) return null;
  return (
    <View className="flex-row items-center" style={{ gap: 1 }}>
      {symbols.map((sym, i) => (
        <ManaSymbol key={i} symbol={sym.slice(1, -1)} size={size} />
      ))}
    </View>
  );
}
