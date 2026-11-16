import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, Dimensions,
  ActionSheetIOS, Alert, Platform,
} from "react-native";
import { useNavigation } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  COLOR_ORDER,
  DEFAULT_DIR,
  EMPTY_FILTERS,
  SORT_LABELS,
  cardValue,
  filterCards,
  isFiltered,
  sortCards,
  type CollectionCard,
  type FilterState,
  type SortDir,
  type SortKey,
} from "@mtg/shared";
import { api } from "../../src/lib/api";
import { exportFilename, pickExportFormat, shareCsv } from "../../src/lib/exports";
import { lookupSet, useScryfallSets } from "../../src/lib/scryfallSets";
import CardImage from "../../src/components/CardImage";
import CardDetailModal from "../../src/components/CardDetailModal";
import ImportCollectionModal from "../../src/components/ImportCollectionModal";
import AddCardModal from "../../src/components/AddCardModal";
import CollectionFilterSheet, { MODE_LABELS } from "../../src/components/CollectionFilterSheet";
import { ColorPips, ManaCost } from "../../src/components/ManaSymbols";
import SetSymbol from "../../src/components/SetSymbol";

// The collection browser — the web's filters, sorts, grid and list, plus add,
// remove and export. Filtering and sorting run on the shared logic the web uses,
// over the whole collection the API sends in one request.

const NUM_COLUMNS = 3;
const SCREEN_WIDTH = Dimensions.get("window").width;
const GAP = 8;
const CARD_WIDTH = (SCREEN_WIDTH - GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

type View_ = "grid" | "list";

function HeaderButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
      className="h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900"
      activeOpacity={0.7}
    >
      <MaterialCommunityIcons name={icon as never} size={18} color="#cbd5e1" />
    </TouchableOpacity>
  );
}

function ActiveChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <TouchableOpacity
      onPress={onClear}
      activeOpacity={0.7}
      className="flex-row items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1"
    >
      {children}
      <Text className="text-xs text-slate-500">✕</Text>
    </TouchableOpacity>
  );
}

const chipText = "text-xs text-slate-300";

export default function CollectionScreen() {
  const navigation = useNavigation();
  const setIndex = useScryfallSets();
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<SortDir>("asc");
  const [view, setView] = useState<View_>("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<CollectionCard | null>(null);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  // Refresh after an import or edit *without* flipping `loading` — that would
  // swap the whole screen for a spinner and tear down whichever sheet is open.
  const refresh = useCallback(() => {
    void fetchCards();
  }, [fetchCards]);

  const exportCollection = useCallback(async () => {
    const format = await pickExportFormat("Export collection");
    if (!format) return;
    setExporting(true);
    try {
      const csv = await api.exportCollectionText(format);
      await shareCsv(csv, exportFilename("collection", format));
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setExporting(false);
    }
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="mr-4 flex-row items-center gap-2">
          {exporting ? (
            <ActivityIndicator size="small" color="#cbd5e1" />
          ) : (
            <HeaderButton icon="export-variant" label="Export collection" onPress={exportCollection} />
          )}
          <HeaderButton icon="plus" label="Add card" onPress={() => setAdding(true)} />
          <HeaderButton icon="tray-arrow-down" label="Import collection" onPress={() => setImporting(true)} />
        </View>
      ),
    });
  }, [navigation, exportCollection, exporting]);

  // Re-filtering thousands of cards takes a moment, so the list follows the
  // filters a beat behind and the controls stay responsive meanwhile.
  const deferredFilters = useDeferredValue(filters);
  const visible = useMemo(
    () => sortCards(filterCards(cards, deferredFilters), sort, dir),
    [cards, deferredFilters, sort, dir],
  );

  function chooseSort() {
    const keys = Object.keys(SORT_LABELS) as SortKey[];
    const pick = (key: SortKey) => {
      setSort(key);
      setDir(DEFAULT_DIR[key]);
    };
    if (Platform.OS !== "ios") return pick(keys[(keys.indexOf(sort) + 1) % keys.length]);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Sort by", options: [...keys.map((k) => SORT_LABELS[k]), "Cancel"], cancelButtonIndex: keys.length },
      (i) => {
        if (i < keys.length) pick(keys[i]);
      },
    );
  }

  const set = (patch: Partial<FilterState>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleOut = <T,>(list: T[], v: T) => list.filter((x) => x !== v);

  // Every active narrowing as a removable chip, the same list the web shows.
  const active: { key: string; node: ReactNode; clear: () => void }[] = [];
  if (filters.sets.length) {
    active.push({
      key: "sets",
      node: (
        <Text className={chipText}>
          {filters.sets.length === 1
            ? (lookupSet(setIndex, filters.sets[0])?.name ?? filters.sets[0].toUpperCase())
            : `${filters.sets.length} sets`}
        </Text>
      ),
      clear: () => set({ sets: [] }),
    });
  }
  if (filters.colors.length || filters.colorless) {
    active.push({
      key: "colors",
      node: (
        <View className="flex-row items-center gap-1">
          <Text className={chipText}>{MODE_LABELS[filters.colorMode]}</Text>
          {filters.colors.length > 0 && (
            <ColorPips colors={COLOR_ORDER.filter((c) => filters.colors.includes(c))} size={13} />
          )}
          {filters.colorless && <ColorPips colors={[]} size={13} />}
        </View>
      ),
      clear: () => set({ colors: [], colorless: false }),
    });
  }
  for (const t of filters.types) {
    active.push({ key: `t-${t}`, node: <Text className={chipText}>{t}</Text>, clear: () => set({ types: toggleOut(filters.types, t) }) });
  }
  for (const r of filters.rarities) {
    active.push({ key: `r-${r}`, node: <Text className={chipText}>{r}</Text>, clear: () => set({ rarities: toggleOut(filters.rarities, r) }) });
  }
  if (filters.cmcMin !== null || filters.cmcMax !== null) {
    active.push({
      key: "mv",
      node: <Text className={chipText}>MV {filters.cmcMin ?? 0}–{filters.cmcMax ?? "∞"}</Text>,
      clear: () => set({ cmcMin: null, cmcMax: null }),
    });
  }
  if (filters.finish !== "any") {
    active.push({ key: "finish", node: <Text className={chipText}>{filters.finish}</Text>, clear: () => set({ finish: "any" }) });
  }
  if (filters.availability !== "owned") {
    active.push({ key: "avail", node: <Text className={chipText}>Available only</Text>, clear: () => set({ availability: "owned" }) });
  }
  if (filters.minCopies !== null) {
    active.push({ key: "copies", node: <Text className={chipText}>{filters.minCopies}+ copies</Text>, clear: () => set({ minCopies: null }) });
  }
  if (filters.reservedOnly) {
    active.push({ key: "rl", node: <Text className={chipText}>Reserved List</Text>, clear: () => set({ reservedOnly: false }) });
  }
  if (filters.gameChangersOnly) {
    active.push({ key: "gc", node: <Text className={chipText}>Game Changers</Text>, clear: () => set({ gameChangersOnly: false }) });
  }
  if (filters.colorSource !== "identity") {
    active.push({ key: "csrc", node: <Text className={chipText}>Card colors</Text>, clear: () => set({ colorSource: "identity" }) });
  }
  // The search box shows its own text; it isn't repeated as a chip.
  const sheetCount = active.length;

  const header = (
    <View className="border-b border-slate-800 px-4 pb-2 pt-2">
      <View className="flex-row items-center gap-2">
        <TextInput
          value={filters.q}
          onChangeText={(q) => set({ q })}
          placeholder="Search name, type, or rules text…"
          placeholderTextColor="#64748b"
          autoCorrect={false}
          clearButtonMode="while-editing"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
        />
        <TouchableOpacity
          onPress={() => setFiltersOpen(true)}
          activeOpacity={0.7}
          className={
            "flex-row items-center gap-1 rounded-lg border px-3 py-2 " +
            (sheetCount ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700")
          }
        >
          <MaterialCommunityIcons name="filter-variant" size={16} color={sheetCount ? "#6ee7b7" : "#94a3b8"} />
          <Text className={"text-sm " + (sheetCount ? "text-emerald-300" : "text-slate-400")}>
            {sheetCount ? sheetCount : "Filters"}
          </Text>
        </TouchableOpacity>
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <View className="flex-row items-center gap-1">
          <TouchableOpacity onPress={chooseSort} activeOpacity={0.7} className="rounded-lg border border-slate-700 px-2.5 py-1.5">
            <Text className="text-xs text-slate-300">Sort: {SORT_LABELS[sort]}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDir(dir === "asc" ? "desc" : "asc")}
            accessibilityLabel={dir === "asc" ? "Ascending" : "Descending"}
            activeOpacity={0.7}
            className="rounded-lg border border-slate-700 px-2.5 py-1.5"
          >
            <Text className="text-xs text-slate-300">{dir === "asc" ? "↑" : "↓"}</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row rounded-lg border border-slate-700 p-0.5">
          {(["grid", "list"] as const).map((v) => (
            <TouchableOpacity
              key={v}
              onPress={() => setView(v)}
              accessibilityLabel={v === "grid" ? "Grid view" : "List view"}
              accessibilityState={{ selected: view === v }}
              activeOpacity={0.7}
              className={"rounded-md px-2.5 py-1 " + (view === v ? "bg-slate-800" : "")}
            >
              <MaterialCommunityIcons
                name={v === "grid" ? "view-grid-outline" : "view-list"}
                size={16}
                color={view === v ? "#f1f5f9" : "#64748b"}
              />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isFiltered(filters) && (
        <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
          <Text className="text-xs text-slate-500">
            {visible.length.toLocaleString()} of {cards.length.toLocaleString()} cards
          </Text>
          {active.map((chip) => (
            <ActiveChip key={chip.key} onClear={chip.clear}>
              {chip.node}
            </ActiveChip>
          ))}
          <TouchableOpacity onPress={() => setFilters(EMPTY_FILTERS)} hitSlop={6} activeOpacity={0.6}>
            <Text className="ml-1 text-xs text-slate-500 underline">Clear all</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const empty = (
    <Text className="mt-10 text-center text-sm text-slate-500">No cards match these filters.</Text>
  );

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
          <Text className="mt-4 text-center text-base text-slate-400">No cards in your collection yet.</Text>
          <Text className="mt-2 text-center text-sm leading-5 text-slate-500">
            Import a CSV or Excel export from Moxfield, Archidekt, Dragon Shield, Deckbox or ManaBox to get started,
            or add cards one at a time.
          </Text>
          <TouchableOpacity
            onPress={() => setImporting(true)}
            activeOpacity={0.8}
            className="mt-6 rounded-xl bg-emerald-700 px-6 py-3"
          >
            <Text className="text-base font-semibold text-white">Import collection</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAdding(true)} activeOpacity={0.7} className="mt-3 py-2">
            <Text className="text-sm text-slate-400">Add a card</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {header}
          {view === "grid" ? (
            <FlatList
              key="grid"
              data={visible}
              keyExtractor={(item) => item.oracle_id}
              numColumns={NUM_COLUMNS}
              contentContainerStyle={{ padding: GAP }}
              columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
              keyboardDismissMode="on-drag"
              ListEmptyComponent={empty}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => setSelected(item)} activeOpacity={0.7} style={{ width: CARD_WIDTH }}>
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
            />
          ) : (
            <FlatList
              key="list"
              data={visible}
              keyExtractor={(item) => item.oracle_id}
              keyboardDismissMode="on-drag"
              ListEmptyComponent={empty}
              renderItem={({ item }) => {
                const p = item.printings?.[0];
                const value = cardValue(item);
                return (
                  <TouchableOpacity
                    onPress={() => setSelected(item)}
                    activeOpacity={0.6}
                    className="flex-row items-center gap-3 border-b border-slate-800/60 px-4 py-2.5"
                  >
                    <SetSymbol iconUri={lookupSet(setIndex, p?.edition)?.iconSvgUri} code={p?.edition} size={16} />
                    <View className="flex-1">
                      <Text className="text-sm text-slate-200" numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text className="text-xs text-slate-500" numberOfLines={1}>
                        {item.type_line}
                      </Text>
                    </View>
                    <ManaCost cost={item.mana_cost} size={12} />
                    <View className="w-14 items-end">
                      <Text className="text-xs text-slate-300">×{item.total_count}</Text>
                      {value > 0 && <Text className="text-xs text-emerald-400/80">${value.toFixed(2)}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
          <CardDetailModal card={selected} onRemoved={refresh} onClose={() => setSelected(null)} />
        </>
      )}

      <CollectionFilterSheet
        visible={filtersOpen}
        filters={filters}
        onChange={setFilters}
        resultCount={visible.length}
        onClose={() => setFiltersOpen(false)}
      />
      <AddCardModal visible={adding} onAdded={refresh} onClose={() => setAdding(false)} />
      <ImportCollectionModal
        visible={importing}
        hasCollection={cards.length > 0}
        onImported={refresh}
        onClose={() => setImporting(false)}
      />
    </View>
  );
}
