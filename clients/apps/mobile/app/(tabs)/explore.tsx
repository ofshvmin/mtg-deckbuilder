import { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import {
  edhrecPreviewCards,
  type Color,
  type CommanderOption,
  type ExternalDeckResponse,
  type ExternalDeckSummary,
  type PreconSummary,
} from "@mtg/shared";
import { api } from "../../src/lib/api";
import { CommanderArtImage } from "../../src/components/CardImage";
import DeckView from "../../src/components/DeckView";
import { ColorPips } from "../../src/components/ManaSymbols";

// Explore — the web's Explore page: official precons, and community decks from
// EDHREC by commander (or by pasting an EDHREC/Archidekt link). A deck opens in
// the deck view showing what you own of it; save it, then add its missing cards
// to your collection.

type Tab = "precons" | "community";

const fill = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

/** Best-effort commander name for a precon without one recorded. */
function preconArtName(p: PreconSummary): string {
  if (p.commander_name) return p.commander_name;
  return p.name
    .replace(/\s*Collector'?s?\s*Edition\s*/i, " ")
    .replace(/\s*\([^)]+\)\s*$/, "")
    .trim();
}

function Tile({
  title,
  badge,
  artCropUrl,
  artist,
  artName,
  footer,
  onPress,
  disabled,
}: {
  title: string;
  badge?: string;
  artCropUrl?: string | null;
  artist?: string | null;
  artName: string;
  footer: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60"
    >
      <View style={{ height: 110 }}>
        <CommanderArtImage name={artName} artCropUrl={artCropUrl} artist={artist} style={fill} />
        <View style={{ ...fill, backgroundColor: "rgba(2,6,23,0.55)" }} />
        {badge && (
          <View className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5">
            <Text className="text-xs font-medium text-slate-200">{badge}</Text>
          </View>
        )}
        <View className="absolute bottom-0 left-0 right-0 p-3">
          <Text className="text-sm font-semibold text-white" numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>
      <View className="px-3 py-2">{footer}</View>
    </TouchableOpacity>
  );
}

export default function ExploreScreen() {
  const [tab, setTab] = useState<Tab>("precons");

  // Precons
  const [preconQuery, setPreconQuery] = useState("");
  const [precons, setPrecons] = useState<PreconSummary[]>([]);
  const [preconsLoading, setPreconsLoading] = useState(false);
  const [preconsError, setPreconsError] = useState<string | null>(null);

  // Community
  const [commander, setCommander] = useState("");
  const [suggestions, setSuggestions] = useState<CommanderOption[]>([]);
  // The name last searched for — no suggestions while the box still shows it.
  const [searchedFor, setSearchedFor] = useState("");
  const [results, setResults] = useState<ExternalDeckSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  // The open deck
  const [fetched, setFetched] = useState<ExternalDeckResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const loadPrecons = useCallback(async (q: string) => {
    setPreconsLoading(true);
    setPreconsError(null);
    try {
      setPrecons(await api.searchPrecons(q, 30));
    } catch (e) {
      setPreconsError(e instanceof Error ? e.message : "Failed to load precons");
    } finally {
      setPreconsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPrecons("");
  }, [loadPrecons]);

  // Commander autocomplete, over every commander-eligible card (not just owned).
  useEffect(() => {
    if (commander.trim().length < 2 || commander.trim() === searchedFor) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      api.searchAllCommanders(commander.trim(), 8).then(setSuggestions).catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [commander, searchedFor]);

  async function search(name = commander) {
    const q = name.trim();
    if (!q) return;
    setSuggestions([]);
    setSearchedFor(q);
    setSearching(true);
    setSearchError(null);
    try {
      const data = await api.searchExternalDecks(q);
      setResults(data);
      if (!data.length) setSearchError("No decks found for that commander on EDHREC.");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  /** Load a deck, then open it. */
  async function open(load: () => Promise<ExternalDeckResponse>) {
    setFetching(true);
    setFetchError(null);
    setSavedId(null);
    try {
      setFetched(await load());
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load deck");
    } finally {
      setFetching(false);
    }
  }

  const openPrecon = (p: PreconSummary) => open(() => api.fetchPrecon(p.file_name));
  const openUrl = () => open(() => api.fetchExternalDeck({ url: url.trim() }));
  const openResult = (r: ExternalDeckSummary) =>
    open(async () => {
      const preview = await api.fetchEdhrecDeck(r.external_id);
      const cards = preview ? edhrecPreviewCards(preview) : [];
      if (!cards.length) throw new Error("Could not load deck.");
      return api.resolveExternalDeck({
        cards,
        source: r.source,
        source_url: r.url,
        name: r.name,
        owner: r.owner,
      });
    });

  /** Add the open deck's cards to the collection — the web's ImportCardsModal. */
  function importCards() {
    if (!fetched) return;
    const cards = fetched.deck.cards.map((c) => ({ name: c.name, oracle_id: c.oracle_id, count: c.count }));
    const total = cards.reduce((n, c) => n + c.count, 0);
    const run = async (mode: "ignore_duplicates" | "import_all") => {
      try {
        const res = await api.batchAddToCollection(cards, mode);
        Alert.alert(
          "Added to your collection",
          `Added ${res.added} card(s).` +
            (res.skipped > 0 ? ` Skipped ${res.skipped} (already owned or unresolved).` : ""),
        );
      } catch (e) {
        Alert.alert("Import failed", e instanceof Error ? e.message : "Please try again.");
      }
    };
    Alert.alert(
      "Import cards to collection",
      `This deck has ${total} cards (${fetched.unowned_count} not in your collection).`,
      [
        { text: `Ignore duplicates (add ~${fetched.unowned_count} new)`, onPress: () => void run("ignore_duplicates") },
        { text: `Import all (add ${total})`, onPress: () => void run("import_all") },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  const banner = fetched && (
    <View className="gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <Text className="text-sm text-slate-400">
        {fetched.source === "precon" ? (
          "Official precon"
        ) : (
          <>
            From <Text className="capitalize text-slate-200">{fetched.source}</Text>
          </>
        )}
        {fetched.owner !== "Unknown" && fetched.owner !== "EDHREC" && fetched.source !== "precon" ? (
          <>
            {" "}by <Text className="text-slate-200">{fetched.owner}</Text>
          </>
        ) : null}
        {"  ·  "}
        <Text className="text-emerald-400">{fetched.owned_count} owned</Text>
        {fetched.unowned_count > 0 ? <Text className="text-slate-500">  ·  {fetched.unowned_count} unowned</Text> : null}
      </Text>
      {savedId ? (
        <TouchableOpacity onPress={importCards} className="self-start rounded-lg bg-emerald-700 px-3 py-1.5" activeOpacity={0.8}>
          <Text className="text-xs font-medium text-white">Import cards to collection</Text>
        </TouchableOpacity>
      ) : (
        <Text className="text-xs text-slate-500">Save it to your decks to add its cards to your collection.</Text>
      )}
    </View>
  );

  const header = (
    <View className="gap-3 pb-3">
      <View className="flex-row rounded-lg border border-slate-700 p-0.5">
        {(["precons", "community"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            className={"flex-1 rounded-md py-2 " + (tab === t ? "bg-slate-800" : "")}
            activeOpacity={0.7}
          >
            <Text className={"text-center text-sm " + (tab === t ? "text-white" : "text-slate-400")}>
              {t === "precons" ? "Precons" : "Community"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "precons" ? (
        <TextInput
          value={preconQuery}
          onChangeText={setPreconQuery}
          onSubmitEditing={() => void loadPrecons(preconQuery)}
          returnKeyType="search"
          placeholder="Search precons by name or set code…"
          placeholderTextColor="#64748b"
          autoCorrect={false}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
        />
      ) : (
        <>
          <View className="flex-row gap-2">
            <TextInput
              value={commander}
              onChangeText={setCommander}
              onSubmitEditing={() => void search()}
              returnKeyType="search"
              placeholder="Search by commander name…"
              placeholderTextColor="#64748b"
              autoCorrect={false}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
            />
            <TouchableOpacity
              onPress={() => void search()}
              disabled={searching || !commander.trim()}
              className="justify-center rounded-lg bg-indigo-600 px-4 disabled:opacity-50"
              activeOpacity={0.8}
            >
              <Text className="text-sm font-medium text-white">{searching ? "…" : "Search"}</Text>
            </TouchableOpacity>
          </View>
          {suggestions.length > 0 && (
            <View className="rounded-lg border border-slate-700 bg-slate-900">
              {suggestions.map((c) => (
                <TouchableOpacity
                  key={c.oracle_id}
                  onPress={() => {
                    setCommander(c.name);
                    void search(c.name);
                  }}
                  className="flex-row items-center justify-between border-b border-slate-800/60 px-3 py-2.5"
                  activeOpacity={0.6}
                >
                  <Text className="flex-1 text-sm text-slate-100" numberOfLines={1}>
                    {c.name}
                  </Text>
                  <ColorPips colors={c.color_identity} size={14} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View className="flex-row gap-2">
            <TextInput
              value={url}
              onChangeText={setUrl}
              onSubmitEditing={openUrl}
              placeholder="Or paste an EDHREC or Archidekt link…"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
            />
            <TouchableOpacity
              onPress={openUrl}
              disabled={fetching || !url.trim()}
              className="justify-center rounded-lg border border-slate-700 px-4 disabled:opacity-50"
              activeOpacity={0.8}
            >
              <Text className="text-sm text-slate-200">Open</Text>
            </TouchableOpacity>
          </View>
          {searchError && <Text className="text-sm text-rose-400">{searchError}</Text>}
        </>
      )}

      {fetchError && <Text className="text-sm text-rose-400">{fetchError}</Text>}
      {fetching && (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#64748b" />
          <Text className="text-sm text-slate-400">Loading deck…</Text>
        </View>
      )}
      {tab === "precons" && preconsError && <Text className="text-sm text-rose-400">{preconsError}</Text>}
    </View>
  );

  return (
    <View className="flex-1 bg-slate-950">
      {tab === "precons" ? (
        <FlatList
          key="precons"
          data={precons}
          keyExtractor={(p) => p.file_name}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={header}
          ListEmptyComponent={
            preconsLoading ? (
              <ActivityIndicator size="small" color="#64748b" />
            ) : !preconsError ? (
              <Text className="text-center text-sm text-slate-500">No precons found.</Text>
            ) : null
          }
          renderItem={({ item: p }) => (
            <Tile
              title={p.name}
              badge={p.code.toUpperCase()}
              artName={preconArtName(p)}
              artCropUrl={p.commander_art_crop}
              artist={p.commander_artist}
              onPress={() => void openPrecon(p)}
              disabled={fetching}
              footer={
                <View className="flex-row items-center gap-1.5">
                  {p.commander_name ? (
                    <>
                      <Text className="shrink text-xs text-slate-400" numberOfLines={1}>
                        {p.commander_name} ·
                      </Text>
                      <ColorPips colors={(p.color_identity ?? []) as Color[]} size={13} />
                      <Text className="text-xs text-slate-400"> · </Text>
                    </>
                  ) : null}
                  <Text className="text-xs text-slate-400">{p.release_date}</Text>
                </View>
              }
            />
          )}
        />
      ) : (
        <FlatList
          key="community"
          data={results}
          keyExtractor={(r) => r.external_id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={header}
          renderItem={({ item: d }) => (
            <Tile
              title={d.name}
              badge={d.bracket != null ? `B${d.bracket}` : undefined}
              artName={d.commander_name || "Unknown"}
              artCropUrl={d.commander_art_crop}
              artist={d.commander_artist}
              onPress={() => void openResult(d)}
              disabled={fetching}
              footer={
                <View className="flex-row items-center gap-1.5">
                  <Text className="shrink text-xs text-slate-400" numberOfLines={1}>
                    {d.commander_name} ·
                  </Text>
                  <ColorPips colors={d.color_identity as Color[]} size={13} />
                  <Text className="text-xs text-slate-400">
                    · {d.card_count} cards{d.price != null ? ` · $${d.price}` : ""}
                  </Text>
                </View>
              }
            />
          )}
        />
      )}

      {fetched && (
        <DeckView
          key={`${fetched.source}:${fetched.source_url}:${fetched.name}`}
          deck={fetched.deck}
          suggestedName={fetched.name}
          deckId={savedId ?? undefined}
          showOwnership
          saveSource={{ source: fetched.source, ...(fetched.source_url ? { source_url: fetched.source_url } : {}) }}
          banner={banner}
          onSaved={(saved) => setSavedId(saved.id)}
          onClose={() => {
            setFetched(null);
            setSavedId(null);
          }}
        />
      )}
    </View>
  );
}
