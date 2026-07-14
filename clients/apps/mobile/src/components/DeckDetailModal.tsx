import { useMemo, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, SectionList } from "react-native";
import type { DeckCard, GeneratedDeck } from "@mtg/shared";
import CardImage, { CommanderArtImage } from "./CardImage";
import CardDetailModal from "./CardDetailModal";

const SLOTS: { key: string; label: string; color: string }[] = [
  { key: "land", label: "Lands", color: "#f59e0b" },
  { key: "ramp", label: "Ramp", color: "#10b981" },
  { key: "card_draw", label: "Card Draw", color: "#0ea5e9" },
  { key: "removal", label: "Removal", color: "#f43f5e" },
  { key: "board_wipe", label: "Board Wipes", color: "#dc2626" },
  { key: "game_plan", label: "Game Plan", color: "#d946ef" },
];

export default function DeckDetailModal({
  deck,
  name,
  onClose,
}: {
  deck: GeneratedDeck;
  name: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<DeckCard | null>(null);

  const sections = useMemo(() => {
    return SLOTS.map((s) => ({
      ...s,
      data: deck.cards.filter((c) => c.slot === s.key),
    })).filter((s) => s.data.length > 0);
  }, [deck.cards]);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View className="flex-1 bg-slate-950">
        {/* Header */}
        <View className="border-b border-slate-800 px-4 pb-3 pt-14">
          <View className="flex-row items-center justify-between">
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text className="text-sm text-indigo-400">← Back</Text>
            </TouchableOpacity>
          </View>
          <Text className="mt-2 text-xl font-bold text-white">{name}</Text>
          <Text className="mt-0.5 text-sm text-slate-400">
            {deck.commander.name} · {deck.color_identity.join("") || "C"} · {deck.total} cards
          </Text>
        </View>

        {/* Stats row */}
        <View className="flex-row border-b border-slate-800 px-4 py-3">
          <Stat label="Lands" value={deck.land_count} />
          <Stat label="Nonlands" value={deck.nonland_count} />
          <Stat label="Avg MV" value={deck.stats.avg_nonland_mv?.toFixed(2) ?? "—"} />
          {deck.bracket && <Stat label="Bracket" value={deck.bracket.bracket} />}
        </View>

        {/* Card list grouped by slot */}
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => `${item.oracle_id}-${index}`}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderSectionHeader={({ section }) => (
            <View className="flex-row items-center gap-2 bg-slate-950 px-4 py-2">
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: section.color }} />
              <Text className="text-xs font-medium uppercase tracking-wider text-slate-300">
                {section.label}
              </Text>
              <Text className="text-xs text-slate-500">
                {section.data.reduce((s: number, c: DeckCard) => s + c.count, 0)}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setSelected(item)}
              activeOpacity={0.6}
              className="flex-row items-center gap-2 px-4 py-1.5"
            >
              <Text className="flex-1 text-sm text-slate-200" numberOfLines={1}>
                {item.count > 1 && <Text className="text-slate-500">{item.count}× </Text>}
                {item.name}
                {item.in_combo && <Text className="text-fuchsia-400"> ⚡</Text>}
                {item.quality >= 0.3 && <Text className="text-emerald-400"> ◆</Text>}
              </Text>
              <Text className="text-xs text-slate-500">{item.mana_cost}</Text>
            </TouchableOpacity>
          )}
          stickySectionHeadersEnabled
        />

        {/* Combos */}
        {deck.combos.length > 0 && (
          <View className="border-t border-slate-800 px-4 py-3">
            <Text className="text-xs font-medium uppercase tracking-wider text-fuchsia-300">
              Combos ({deck.combos.length})
            </Text>
            {deck.combos.slice(0, 5).map((combo) => (
              <Text key={combo.id} className="mt-1 text-xs text-slate-300">
                {combo.cards.join(" + ")}
              </Text>
            ))}
          </View>
        )}
      </View>

      {selected && (
        <CardDetailModal
          card={{
            name: selected.name,
            mana_cost: selected.mana_cost,
            type_line: selected.type_line,
            printings: selected.printings,
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View className="flex-1 items-center">
      <Text className="text-lg font-bold text-white">{value}</Text>
      <Text className="text-xs text-slate-500">{label}</Text>
    </View>
  );
}
