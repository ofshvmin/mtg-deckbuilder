import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import type { GeneratedDeck, SavedDeckSummary } from "@mtg/shared";
import { api } from "../../src/lib/api";
import { CommanderArtImage } from "../../src/components/CardImage";
import DeckDetailModal from "../../src/components/DeckDetailModal";

export default function DecksScreen() {
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDeck, setOpenDeck] = useState<{ id: string; name: string; deck: GeneratedDeck } | null>(null);
  const [opening, setOpening] = useState(false);

  const loadDecks = useCallback(() => {
    api.listSavedDecks().then(setDecks).catch(() => setDecks([])).finally(() => setLoading(false));
  }, []);

  useEffect(loadDecks, [loadDecks]);

  async function openDeckById(id: string) {
    setOpening(true);
    try {
      const saved = await api.getSavedDeck(id);
      setOpenDeck({ id: saved.id, name: saved.name, deck: saved.deck });
    } catch {
      // silent
    } finally {
      setOpening(false);
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#d8b25c" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <FlatList
        data={decks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <Text className="text-center text-sm text-slate-500">
            No saved decks yet — build one from the Build tab.
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => openDeckById(item.id)}
            disabled={opening}
            activeOpacity={0.7}
            className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60"
          >
            <View style={{ height: 120 }}>
              <CommanderArtImage
                name={item.commander_name}
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
              />
              <View
                style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: "rgba(2,6,23,0.6)",
                }}
              />
              {item.bracket != null && (
                <View className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5">
                  <Text className="text-xs font-medium text-slate-200">B{item.bracket}</Text>
                </View>
              )}
              <View className="absolute bottom-0 left-0 right-0 p-3">
                <Text className="text-sm font-semibold text-white" numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center justify-between px-3 py-2">
              <Text className="flex-1 text-xs text-slate-400" numberOfLines={1}>
                {item.commander_name} · {item.color_identity.join("") || "C"} · {item.total} cards
              </Text>
              {item.source && (
                <Text className="text-xs text-slate-600">{item.source}</Text>
              )}
            </View>
          </TouchableOpacity>
        )}
      />

      {openDeck && (
        <DeckDetailModal
          deck={openDeck.deck}
          name={openDeck.name}
          onClose={() => setOpenDeck(null)}
        />
      )}
    </View>
  );
}
