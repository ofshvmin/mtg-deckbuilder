import { Text, View } from "react-native";
import { Image } from "expo-image";

// A set's Scryfall icon. The SVGs are black, so they're tinted light to read on
// the dark UI; a set with no icon shows its code instead.
export default function SetSymbol({
  iconUri,
  code,
  size = 16,
  color = "#cbd5e1",
}: {
  iconUri?: string;
  code?: string | null;
  size?: number;
  color?: string;
}) {
  if (!iconUri) {
    return (
      <View style={{ minWidth: size, height: size }} className="items-center justify-center">
        <Text className="text-[9px] font-semibold uppercase text-slate-500">{(code || "?").slice(0, 4)}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: iconUri }}
      style={{ width: size, height: size }}
      contentFit="contain"
      tintColor={color}
      accessibilityLabel={code ? `${code} set symbol` : "set symbol"}
    />
  );
}
