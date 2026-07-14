import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, Dimensions } from "react-native";
import type { CollectionCard } from "@mtg/shared";
import { api } from "../../src/lib/api";
import CardImage from "../../src/components/CardImage";
import CardDetailModal from "../../src/components/CardDetailModal";

const NUM_COLUMNS = 3;
const SCREEN_WIDTH = Dimensions.get("window").width;
const GAP = 8;
const CARD_WIDTH = (SCREEN_WIDTH - GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

export default function CollectionScreen() {
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<CollectionCard | null>(null);

  useEffect(() => {
    api
      .listCollectionCards()
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? cards.filter((c) => c.name.toLowerCase().includes(f)) : cards;
  }, [cards, filter]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#d8b25c" />
      </View>
    );
  }

  if (cards.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950 px-8">
        <Text className="text-center text-base text-slate-400">
          No cards in your collection yet. Import your collection on the web app to get started.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
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
    </View>
  );
}
