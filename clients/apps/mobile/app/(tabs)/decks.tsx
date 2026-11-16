import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { GeneratedDeck, SavedDeckSummary } from "@mtg/shared";
import { api } from "../../src/lib/api";
import { CommanderArtImage } from "../../src/components/CardImage";
import DeckView from "../../src/components/DeckView";
import ImportDeckModal from "../../src/components/ImportDeckModal";
import CompareModal from "../../src/components/CompareModal";
import { ColorPips } from "../../src/components/ManaSymbols";

// Bracket badge tones, low (casual, cool) to high (spicy, warm) — the web's.
const BRACKET_TONE: Record<number, string> = {
  1: "border-slate-500 bg-slate-800/80",
  2: "border-emerald-600 bg-emerald-950/80",
  3: "border-sky-600 bg-sky-950/80",
  4: "border-orange-600 bg-orange-950/80",
  5: "border-rose-600 bg-rose-950/80",
};
const BRACKET_TEXT: Record<number, string> = {
  1: "text-slate-200",
  2: "text-emerald-300",
  3: "text-sky-300",
  4: "text-orange-300",
  5: "text-rose-300",
};

export default function DecksScreen() {
  const navigation = useNavigation();
  const [importing, setImporting] = useState(false);
  // Compare mode: tap two decks, then compare them.
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [openDeck, setOpenDeck] = useState<
    { id: string; name: string; deck: GeneratedDeck; inUse: boolean; source?: string | null } | null
  >(null);
  const [opening, setOpening] = useState(false);

  const { open } = useLocalSearchParams<{ open?: string }>();

  const loadDecks = useCallback(() => {
    return api
      .listSavedDecks()
      .then((d) => {
        setDecks(d);
        setLoadFailed(false);
      })
      // Don't collapse a failed fetch into an empty list: the empty state says
      // "No saved decks yet", which is a confident lie when the request simply
      // didn't come back, and it sends you looking for a deck that saved fine.
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // On focus, not just on mount — decks are saved from the Build tab, and this
  // screen is already mounted by then, so a mount-only fetch leaves a freshly
  // saved deck invisible until the app restarts.
  useFocusEffect(
    useCallback(() => {
      void loadDecks();
    }, [loadDecks]),
  );

  const openDeckById = useCallback(async (id: string) => {
    setOpening(true);
    try {
      const saved = await api.getSavedDeck(id);
      setOpenDeck({
        id: saved.id, name: saved.name, deck: saved.deck, inUse: !!saved.in_use, source: saved.source,
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

  // Opened from Home ("recent decks" tap) with an `open` deck id — show it, then
  // clear the param so the same deck can be reopened later.
  useEffect(() => {
    if (open) {
      openDeckById(open);
      router.setParams({ open: undefined });
    }
  }, [open, openDeckById]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="mr-4 flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => {
              setComparing((c) => !c);
              setPicked([]);
            }}
            accessibilityRole="button"
            className={
              "rounded-full border px-3 py-1 " +
              (comparing ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700 bg-slate-900")
            }
            activeOpacity={0.7}
          >
            <Text className={"text-xs " + (comparing ? "text-emerald-300" : "text-slate-300")}>
              {comparing ? "Cancel" : "Compare"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setImporting(true)}
            accessibilityRole="button"
            accessibilityLabel="Import a deck"
            hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
            className="h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900"
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="tray-arrow-down" size={18} color="#cbd5e1" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, comparing]);

  function pickForCompare(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : [prev[1], id],
    );
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
      {comparing && (
        <View className="flex-row items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-2.5">
          <Text className="text-sm text-slate-300">
            {picked.length < 2 ? `Pick two decks to compare (${picked.length}/2)` : "Ready to compare"}
          </Text>
          <TouchableOpacity
            onPress={() => setCompareIds([picked[0], picked[1]])}
            disabled={picked.length < 2}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 disabled:opacity-40"
            activeOpacity={0.8}
          >
            <Text className="text-sm font-medium text-white">Compare</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={decks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          loadFailed ? (
            <View className="items-center">
              <Text className="text-center text-sm text-slate-400">
                Couldn't load your decks.
              </Text>
              <Text className="mt-1 text-center text-xs text-slate-500">
                Your saved decks are safe — this is a connection problem.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setLoading(true);
                  loadDecks();
                }}
                activeOpacity={0.8}
                className="mt-4 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2"
              >
                <Text className="text-sm font-medium text-slate-200">Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text className="text-center text-sm text-slate-500">
              No saved decks yet — build one from the Build tab, or import one with the button above.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => (comparing ? pickForCompare(item.id) : openDeckById(item.id))}
            disabled={opening}
            activeOpacity={0.7}
            className={
              "overflow-hidden rounded-xl border bg-slate-900/60 " +
              (comparing && picked.includes(item.id) ? "border-emerald-500" : "border-slate-800")
            }
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
                <View className={`absolute right-2 top-2 rounded border px-1.5 py-0.5 ${BRACKET_TONE[item.bracket] ?? BRACKET_TONE[2]}`}>
                  <Text className={`text-xs font-semibold ${BRACKET_TEXT[item.bracket] ?? BRACKET_TEXT[2]}`}>
                    B{item.bracket}
                  </Text>
                </View>
              )}
              {comparing && (
                <View
                  className={
                    "absolute left-2 top-2 h-6 w-6 items-center justify-center rounded-full border-2 " +
                    (picked.includes(item.id) ? "border-emerald-400 bg-emerald-600" : "border-slate-300 bg-black/50")
                  }
                >
                  {picked.includes(item.id) && <Text className="text-xs font-bold text-white">✓</Text>}
                </View>
              )}
              <View className="absolute bottom-0 left-0 right-0 p-3">
                <Text className="text-sm font-semibold text-white" numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center justify-between gap-2 px-3 py-2">
              <View className="flex-1 flex-row items-center gap-1.5">
                <Text className="shrink text-xs text-slate-400" numberOfLines={1}>
                  {item.commander_name} ·
                </Text>
                <ColorPips colors={item.color_identity} size={13} />
                <Text className="shrink text-xs text-slate-400" numberOfLines={1}>
                  · {item.total} cards{item.source ? ` · ${item.source}` : ""}
                </Text>
              </View>
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

      {importing && (
        <ImportDeckModal
          onSaved={(id) => {
            setImporting(false);
            void loadDecks();
            void openDeckById(id);
          }}
          onClose={() => setImporting(false)}
        />
      )}
      {compareIds && <CompareModal ids={compareIds} onClose={() => setCompareIds(null)} />}

      {openDeck && (
        <DeckView
          key={openDeck.id}
          deck={openDeck.deck}
          deckName={openDeck.name}
          deckId={openDeck.id}
          inUse={openDeck.inUse}
          onSaved={() => void loadDecks()}
          // Imported decks (precons, community lists) aren't editable here, as on the web.
          onEdit={
            openDeck.source
              ? undefined
              : () => {
                  const id = openDeck.id;
                  setOpenDeck(null);
                  router.navigate({ pathname: "/build", params: { edit: id } });
                }
          }
          onInUseChange={(next) =>
            setDecks((prev) => prev.map((d) => (d.id === openDeck.id ? { ...d, in_use: next } : d)))
          }
          onClose={() => setOpenDeck(null)}
        />
      )}
    </View>
  );
}
