import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, Dimensions } from "react-native";
import { useNavigation } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CollectionCard } from "@mtg/shared";
import { api } from "../../src/lib/api";
import CardImage from "../../src/components/CardImage";
import CardDetailModal from "../../src/components/CardDetailModal";
import ImportCollectionModal from "../../src/components/ImportCollectionModal";

const NUM_COLUMNS = 3;
const SCREEN_WIDTH = Dimensions.get("window").width;
const GAP = 8;
const CARD_WIDTH = (SCREEN_WIDTH - GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

export default function CollectionScreen() {
  const navigation = useNavigation();
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<CollectionCard | null>(null);
  const [importing, setImporting] = useState(false);

  const fetchCards = useCallback(
    () =>
      api
        .listCollectionCards()
        .then(setCards)
        .catch(() => setCards([])),
    [],
  );

  useEffect(() => {
    void fetchCards().finally(() => setLoading(false));
  }, [fetchCards]);

  // Refresh after an import *without* flipping `loading` — that would swap the
  // whole screen for a spinner and tear down the import sheet the user is
  // still reading the result summary in.
  const refreshAfterImport = useCallback(() => {
    void fetchCards();
  }, [fetchCards]);

  // Header button so a collection that's already populated can still be
  // replaced — the empty state's CTA is otherwise the only way in.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setImporting(true)}
          accessibilityRole="button"
          accessibilityLabel="Import collection"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          className="mr-4 h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900"
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="tray-arrow-down" size={18} color="#cbd5e1" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? cards.filter((c) => c.name.toLowerCase().includes(f)) : cards;
  }, [cards, filter]);

  // One tree for every state, so the import sheet keeps its mount (and its
  // result summary) when the collection flips from empty to populated.
  return (
    <View className="flex-1 bg-slate-950">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#d8b25c" />
        </View>
      ) : cards.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialCommunityIcons name="cards-outline" size={48} color="#334155" />
          <Text className="mt-4 text-center text-base text-slate-400">
            No cards in your collection yet.
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
            Import a CSV or Excel export from Moxfield, Archidekt, Dragon Shield, Deckbox or
            ManaBox to get started.
          </Text>
          <TouchableOpacity
            onPress={() => setImporting(true)}
            activeOpacity={0.8}
            className="mt-6 rounded-xl bg-emerald-700 px-6 py-3"
          >
            <Text className="text-base font-semibold text-white">Import collection</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View className="border-b border-slate-800 px-4 py-2">
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Filter by name…"
              placeholderTextColor="#64748b"
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
            />
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.oracle_id}
            numColumns={NUM_COLUMNS}
            contentContainerStyle={{ padding: GAP }}
            columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelected(item)}
                activeOpacity={0.7}
                style={{ width: CARD_WIDTH }}
              >
                <CardImage
                  name={item.name}
                  printing={item.printings?.[0]}
                  size="small"
                  style={{ width: CARD_WIDTH, borderRadius: 8 }}
                />
                <Text className="mt-1 text-center text-xs text-slate-400" numberOfLines={1}>
                  {item.name}
                </Text>
                {item.total_count > 1 && (
                  <Text className="text-center text-xs text-slate-600">×{item.total_count}</Text>
                )}
              </TouchableOpacity>
            )}
            ListHeaderComponent={
              <Text className="mb-2 text-xs text-slate-500">
                {filtered.length} card{filtered.length !== 1 ? "s" : ""}
              </Text>
            }
          />

          <CardDetailModal card={selected} onClose={() => setSelected(null)} />
        </>
      )}

      <ImportCollectionModal
        visible={importing}
        hasCollection={cards.length > 0}
        onImported={refreshAfterImport}
        onClose={() => setImporting(false)}
      />
    </View>
  );
}
