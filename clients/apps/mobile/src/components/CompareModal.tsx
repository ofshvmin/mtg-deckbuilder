import { useEffect, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { compareDeckCards, groupBySlot, type ComparedCard, type SavedDeck } from "@mtg/shared";
import { api } from "../lib/api";
import { ManaCurve } from "./DeckStats";
import { ColorPips } from "./ManaSymbols";

// Two saved decks side by side — the web's Compare page, stacked for a phone:
// both headers, the stats as "A vs B", each curve, then shared cards and the
// cards unique to each, grouped by role. Blue is the first deck, amber the second,
// as on the web.

function StatRow({ label, a, b, decimal }: { label: string; a: number; b: number; decimal?: boolean }) {
  const fmt = (v: number) => (decimal ? v.toFixed(2) : String(v));
  return (
    <View className="flex-1 items-center rounded-lg border border-slate-800 bg-slate-900/60 py-2.5">
      <Text className="text-[10px] uppercase tracking-wider text-slate-500">{label}</Text>
      <View className="mt-1 flex-row items-center gap-2">
        <Text className="text-base font-bold text-sky-400">{fmt(a)}</Text>
        <Text className="text-[10px] text-slate-600">vs</Text>
        <Text className="text-base font-bold text-amber-400">{fmt(b)}</Text>
      </View>
    </View>
  );
}

function CardGroup({ title, cards, accent }: { title: string; cards: ComparedCard[]; accent: string }) {
  const [open, setOpen] = useState(true);
  return (
    <View className="rounded-xl border border-slate-800 bg-slate-900/40">
      <TouchableOpacity onPress={() => setOpen(!open)} activeOpacity={0.7} className="flex-row items-center justify-between px-4 py-3">
        <Text className={`flex-1 text-sm font-semibold ${accent}`} numberOfLines={1}>
          {title} ({cards.length})
        </Text>
        <Text className="text-slate-500">{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {open &&
        groupBySlot(cards).map((g) => (
          <View key={g.slot} className="border-t border-slate-800">
            <Text className="px-4 pt-2 text-xs font-medium uppercase tracking-wider text-slate-500">
              {g.label} ({g.cards.length})
            </Text>
            {g.cards.map((c) => (
              <View key={c.oracle_id} className="flex-row items-center gap-2 px-4 py-1">
                <Text className="flex-1 text-sm text-slate-300" numberOfLines={1}>
                  {c.name}
                </Text>
                {c.countA != null && c.countB != null && c.countA !== c.countB && (
                  <Text className="text-xs text-slate-500">
                    {c.countA}× / {c.countB}×
                  </Text>
                )}
              </View>
            ))}
            <View className="h-2" />
          </View>
        ))}
    </View>
  );
}

export default function CompareModal({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
  const [decks, setDecks] = useState<[SavedDeck, SavedDeck] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getSavedDeck(ids[0]), api.getSavedDeck(ids[1])])
      .then(([a, b]) => setDecks([a, b]))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load decks"));
  }, [ids]);

  const comparison = decks ? compareDeckCards(decks[0].deck, decks[1].deck) : null;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between border-b border-slate-800 px-4 pb-3 pt-14">
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text className="text-sm text-indigo-400">← Back</Text>
          </TouchableOpacity>
          <Text className="text-base font-semibold text-white">Compare decks</Text>
          <View className="w-12" />
        </View>

        {error && <Text className="p-4 text-sm text-rose-400">{error}</Text>}
        {!decks && !error && <ActivityIndicator size="small" color="#64748b" className="mt-10" />}

        {decks && comparison && (
          <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-16 pt-4">
            {decks.map((d, i) => (
              <View
                key={d.id}
                className={
                  "rounded-xl border bg-slate-900/60 p-3 " + (i === 0 ? "border-sky-800/60" : "border-amber-800/60")
                }
              >
                <Text className={"text-base font-semibold " + (i === 0 ? "text-sky-300" : "text-amber-300")} numberOfLines={1}>
                  {d.name}
                </Text>
                <View className="mt-1 flex-row items-center gap-1.5">
                  {d.deck.commander && <Text className="text-sm text-slate-400">{d.deck.commander.name} ·</Text>}
                  <ColorPips colors={d.deck.color_identity} size={14} />
                </View>
              </View>
            ))}

            <View className="flex-row gap-2">
              <StatRow label="Total" a={decks[0].deck.total} b={decks[1].deck.total} />
              <StatRow label="Lands" a={decks[0].deck.land_count} b={decks[1].deck.land_count} />
            </View>
            <View className="flex-row gap-2">
              <StatRow
                label="Avg MV"
                a={decks[0].deck.stats.avg_nonland_mv ?? 0}
                b={decks[1].deck.stats.avg_nonland_mv ?? 0}
                decimal
              />
              <StatRow label="Bracket" a={decks[0].deck.bracket?.bracket ?? 0} b={decks[1].deck.bracket?.bracket ?? 0} />
            </View>

            {decks.map((d, i) => (
              <View key={`curve-${d.id}`}>
                <Text className={"mb-1.5 text-xs font-medium uppercase tracking-wider " + (i === 0 ? "text-sky-400" : "text-amber-400")}>
                  {d.name}
                </Text>
                <ManaCurve curve={d.deck.curve} />
              </View>
            ))}

            {comparison.shared.length > 0 && (
              <CardGroup title="Shared cards" cards={comparison.shared} accent="text-slate-200" />
            )}
            {comparison.onlyA.length > 0 && (
              <CardGroup title={`Only in ${decks[0].name}`} cards={comparison.onlyA} accent="text-sky-300" />
            )}
            {comparison.onlyB.length > 0 && (
              <CardGroup title={`Only in ${decks[1].name}`} cards={comparison.onlyB} accent="text-amber-300" />
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
