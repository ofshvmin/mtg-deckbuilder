import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { GeneratedDeck, SavedDeckSummary } from "@mtg/shared";
import { api } from "../../src/lib/api";
import { CommanderArtImage } from "../../src/components/CardImage";
import DeckDetailModal from "../../src/components/DeckDetailModal";

export default function DecksScreen() {
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDeck, setOpenDeck] = useState<
    { id: string; name: string; deck: GeneratedDeck; inUse: boolean } | null
  >(null);
  const [opening, setOpening] = useState(false);

  const { open } = useLocalSearchParams<{ open?: string }>();

  const loadDecks = useCallback(() => {
    api.listSavedDecks().then(setDecks).catch(() => setDecks([])).finally(() => setLoading(false));
  }, []);

  useEffect(loadDecks, [loadDecks]);

  const openDeckById = useCallback(async (id: string) => {
    setOpening(true);
    try {
      const saved = await api.getSavedDeck(id);
      setOpenDeck({
        id: saved.id, name: saved.name, deck: saved.deck, inUse: !!saved.in_use,
      });
    } catch {
      // silent
    } finally {
      setOpening(false);
    }
  }, []);

  /** Reserve or release a deck's cards. Optimistic — the badge flips at once and
   *  reverts if the write fails, so sweeping across a shelf of decks stays fluid. */
  const setInUse = useCallback(async (id: string, next: boolean) => {
    setDecks((prev) => prev.map((d) => (d.id === id ? { ...d, in_use: next } : d)));
    setOpenDeck((prev) => (prev && prev.id === id ? { ...prev, inUse: next } : prev));
    try {
      await api.updateSavedDeck(id, { in_use: next });
    } catch {
      setDecks((prev) => prev.map((d) => (d.id === id ? { ...d, in_use: !next } : d)));
      setOpenDeck((prev) => (prev && prev.id === id ? { ...prev, inUse: !next } : prev));
    }
  }, []);

  /** Delete a saved deck, behind a confirm.
   *
   *  A deck marked in use is holding its copies out of every other build; the
   *  pool is derived from the decks that still exist, so deleting it hands those
   *  copies straight back. The prompt says so, since nothing on screen would.
   */
  const removeDeck = useCallback((deck: SavedDeckSummary) => {
    Alert.alert(
      "Delete this deck?",
      `"${deck.name}" will be removed for good.` +
        (deck.in_use
          ? ` Its ${deck.total} cards go back into your available pool.`
          : " Your collection is unchanged."),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDecks((prev) => prev.filter((d) => d.id !== deck.id));
            setOpenDeck((prev) => (prev && prev.id === deck.id ? null : prev));
            try {
              await api.deleteSavedDeck(deck.id);
            } catch {
              loadDecks();   // the write failed — put the tile back
            }
          },
        },
      ],
    );
  }, [loadDecks]);

  /** Point a deck card at a different owned printing, and persist it.
   *
   *  Saved immediately rather than behind a Save button: the mobile deck view is
   *  otherwise read-only, so there's no edit session for the change to sit in.
   */
  async function selectPrinting(oracleId: string, printingKey: string) {
    if (!openDeck) return;
    const updated: GeneratedDeck = {
      ...openDeck.deck,
      cards: openDeck.deck.cards.map((c) =>
        c.oracle_id === oracleId
          ? {
              ...c,
              selected_printing_key: printingKey,
              // One printing takes the whole entry. Splitting across printings
              // only happens automatically, when no single one has enough free.
              printing_allocation: { [printingKey]: c.count },
            }
          : c,
      ),
    };
    setOpenDeck({ ...openDeck, deck: updated });
    try {
      await api.updateSavedDeck(openDeck.id, { deck: updated });
    } catch {
      // Leave the optimistic change on screen; reopening the deck re-reads truth.
    }
  }

  // Opened from Home ("recent decks" tap) with an `open` deck id — show it, then
  // clear the param so the same deck can be reopened later.
  useEffect(() => {
    if (open) {
      openDeckById(open);
      router.setParams({ open: undefined });
    }
  }, [open, openDeckById]);

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
                artCropUrl={item.commander_art_crop}
                artist={item.commander_artist}
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
            <View className="flex-row items-center justify-between gap-2 px-3 py-2">
              <Text className="flex-1 text-xs text-slate-400" numberOfLines={1}>
                {item.commander_name} · {item.color_identity.join("") || "C"} · {item.total} cards
                {item.source ? ` · ${item.source}` : ""}
              </Text>
              <TouchableOpacity
                onPress={() => setInUse(item.id, !item.in_use)}
                hitSlop={8}
                activeOpacity={0.6}
              >
                <Text className={"text-xs " + (item.in_use ? "text-emerald-400" : "text-slate-600")}>
                  {item.in_use ? "◉ In use" : "○ Free"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeDeck(item)}
                hitSlop={8}
                activeOpacity={0.6}
                accessibilityLabel={`Delete ${item.name}`}
              >
                <Text className="text-xs text-slate-600">Delete</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />

      {openDeck && (
        <DeckDetailModal
          deck={openDeck.deck}
          name={openDeck.name}
          inUse={openDeck.inUse}
          onToggleInUse={() => setInUse(openDeck.id, !openDeck.inUse)}
          onSelectPrinting={selectPrinting}
          onClose={() => setOpenDeck(null)}
        />
      )}
    </View>
  );
}
