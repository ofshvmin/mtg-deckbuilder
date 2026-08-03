import { Modal, View, Text, ScrollView, TouchableOpacity, Dimensions } from "react-native";
import type { CollectionCard, DeckCard, Printing } from "@mtg/shared";
import CardImage from "./CardImage";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CARD_WIDTH = SCREEN_WIDTH * 0.75;

interface Props {
  card: {
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    printings?: Printing[];
    /** When shown from a deck: which owned copy that deck currently holds. */
    selected_printing_key?: string | null;
  } | null;
  /** When set, tapping a printing reassigns which copy the deck holds. */
  onSelectPrinting?: (printingKey: string) => void;
  onClose: () => void;
}

export default function CardDetailModal({ card, onSelectPrinting, onClose }: Props) {
  if (!card) return null;

  // Show the copy the deck actually holds, not just the first one owned.
  const printing =
    card.printings?.find((p) => p.printing_key === card.selected_printing_key) ??
    card.printings?.[0];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between border-b border-slate-800 px-4 py-3">
          <Text className="flex-1 text-lg font-semibold text-white" numberOfLines={1}>
            {card.name}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text className="text-lg text-slate-400">✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="items-center px-4 py-6">
          <CardImage
            name={card.name}
            printing={printing}
            size="large"
            style={{ width: CARD_WIDTH, aspectRatio: 745 / 1040, borderRadius: 12 }}
          />

          <View className="mt-4 w-full">
            {card.type_line && (
              <Text className="text-sm text-slate-400">{card.type_line}</Text>
            )}
            {card.mana_cost && (
              <Text className="mt-1 text-sm text-slate-500">{card.mana_cost}</Text>
            )}
            {card.oracle_text && (
              <Text className="mt-3 text-sm leading-5 text-slate-300">{card.oracle_text}</Text>
            )}

            {card.printings && card.printings.length > 0 && (
              <View className="mt-4">
                <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  {onSelectPrinting ? "Which copy this deck uses" : "Owned Printings"}
                </Text>
                {card.printings.map((p, i) => {
                  const isCurrent = p.printing_key === card.selected_printing_key;
                  const row = (
                    <View className="flex-row items-center gap-2 py-1.5">
                      {onSelectPrinting && (
                        <Text className={isCurrent ? "text-emerald-400" : "text-slate-700"}>●</Text>
                      )}
                      <Text className={"text-xs " + (isCurrent ? "text-emerald-300" : "text-slate-300")}>
                        {(p.edition || "???").toUpperCase()} #{p.collector_number || "?"}
                      </Text>
                      <Text className="text-xs text-slate-500">{p.finish}</Text>
                      <Text className="text-xs text-slate-500">
                        {p.available != null ? `${p.available}/${p.count} free` : `×${p.count}`}
                      </Text>
                    </View>
                  );
                  return onSelectPrinting ? (
                    <TouchableOpacity
                      key={i}
                      onPress={() => onSelectPrinting(p.printing_key)}
                      activeOpacity={0.6}
                    >
                      {row}
                    </TouchableOpacity>
                  ) : (
                    <View key={i}>{row}</View>
                  );
                })}
                {onSelectPrinting && (
                  <Text className="mt-1 text-xs text-slate-500">
                    Tap a printing to earmark that copy for this deck.
                  </Text>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
