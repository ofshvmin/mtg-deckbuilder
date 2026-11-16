import type { ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { CardSummary } from "@mtg/shared";
import CardImage from "./CardImage";
import { ManaCost } from "./ManaSymbols";

// A commander shown as the card itself: image, type line, mana cost and rules
// text — the web's CommanderFeature. Used at the top of the deck view and on the
// Build tab once a commander is picked. Tap for the full card sheet.
export default function CommanderCard({
  commander,
  footer,
  onPress,
}: {
  commander: CardSummary;
  /** Extra lines under the rules text, e.g. the build pool's size. */
  footer?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.8}
      className="flex-row gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
    >
      <CardImage name={commander.name} imageUrl={commander.image_uris?.normal} style={{ width: 96, borderRadius: 6 }} />
      <View className="flex-1">
        <Text className="text-base font-semibold text-white">{commander.name}</Text>
        <Text className="text-xs text-slate-400">{commander.type_line}</Text>
        {commander.mana_cost ? (
          <View className="mt-1">
            <ManaCost cost={commander.mana_cost} size={14} />
          </View>
        ) : null}
        {commander.oracle_text ? (
          <Text className="mt-2 text-xs leading-4 text-slate-300" numberOfLines={6}>
            {commander.oracle_text}
          </Text>
        ) : null}
        {footer}
      </View>
    </TouchableOpacity>
  );
}
