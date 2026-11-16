import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import {
  isPremiumRequired,
  type DeckCard,
  type GeneratedDeck,
  type PoolCard,
  type PoolFilters,
  type PoolResponse,
  type SavedDeck,
} from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { BracketBadge, ManaCurve, StatTile } from "./DeckStats";
import { DeckComboFinishers, type CardRef } from "./DeckExtras";
import { ManaCost } from "./ManaSymbols";

// Hands-on deck building — the web's ManualBuilder. Add cards from the legal
// pool and watch the deck take shape: the backend's /decks/compose sorts the
// picks into roles and computes the same stats an auto-built deck has, on each
// (debounced) change. "Get suggestions" runs the auto-builder and floats its
// picks to the top of the pool to cherry-pick from.
//
// Also the editor for an existing deck ("Edit cards"), seeded with its cards
// and saving back over it. A phone shows one half at a time — Pool or Deck.

const PAGE = 100;

const SLOTS: { key: string; label: string; color: string }[] = [
  { key: "land", label: "Lands", color: "#f59e0b" },
  { key: "ramp", label: "Ramp", color: "#10b981" },
  { key: "card_draw", label: "Card Draw", color: "#0ea5e9" },
  { key: "removal", label: "Removal", color: "#f43f5e" },
  { key: "board_wipe", label: "Board Wipes", color: "#dc2626" },
  { key: "game_plan", label: "Game Plan", color: "#d946ef" },
];

function shortType(typeLine: string): string {
  return typeLine.split("—")[0].trim();
}

type Pane = "pool" | "deck";

export default function ManualBuilder({
  pool,
  commanderName,
  strategy,
  theme,
  initialSelected,
  deckId,
  deckName,
  poolFilters,
  onSaved,
  onOpenCard,
}: {
  pool: PoolResponse;
  commanderName: string;
  strategy?: string;
  theme?: string;
  /** Seed the editor from an existing deck. */
  initialSelected?: string[];
  /** When set, Save updates this saved deck in place. */
  deckId?: string;
  deckName?: string;
  /** Pool scope/sets in force, so printings get earmarked from the same slice. */
  poolFilters?: PoolFilters;
  onSaved?: (saved: SavedDeck) => void;
  onOpenCard: (card: CardRef & Partial<PoolCard>) => void;
}) {
  const { user } = useAuth();
  const maxPrice = user?.preferences?.max_card_price ?? null;

  const [pane, setPane] = useState<Pane>(initialSelected?.length ? "deck" : "pool");
  const [selected, setSelected] = useState<string[]>(initialSelected ?? []);
  const [deck, setDeck] = useState<GeneratedDeck | null>(null);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [name, setName] = useState(deckName ?? `${commanderName} Deck`);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(deckId);
  const [savedAs, setSavedAs] = useState<string | null>(deckName ?? null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DeckCard[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const suggestionById = useMemo(
    () => new Map((suggestions ?? []).map((c) => [c.oracle_id, c])),
    [suggestions],
  );

  // Only the latest compose response applies.
  const composeSeq = useRef(0);
  useEffect(() => {
    if (selected.length === 0) {
      composeSeq.current++;
      setDeck(null);
      setComposing(false);
      return;
    }
    setComposing(true);
    const t = setTimeout(() => {
      const seq = ++composeSeq.current;
      api
        .composeDeck(commanderName, selected, pool.format, {
          ...poolFilters,
          // Editing a saved deck: its own copies must read as free.
          ...(deckId ? { exclude_deck_id: deckId } : {}),
        })
        .then((d) => seq === composeSeq.current && setDeck(d))
        .catch(() => {})
        .finally(() => seq === composeSeq.current && setComposing(false));
    }, 350);
    return () => clearTimeout(t);
  }, [selected, commanderName, pool.format, deckId, poolFilters?.pool_scope, poolFilters?.sets]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSuggestions() {
    setLoadingSuggestions(true);
    try {
      const generated = await api.generateDeck(commanderName, {
        ...poolFilters,
        ...(deckId ? { exclude_deck_id: deckId } : {}),
        ...(strategy && strategy !== "Balanced" ? { strategy } : {}),
        ...(theme?.trim() ? { theme: theme.trim() } : {}),
      });
      // Lands are handled automatically; suggest only nonlands.
      setSuggestions(generated.cards.filter((c) => c.slot !== "land"));
      setShowSuggestions(true);
      setPane("pool");
    } catch {
      // A failed suggestion run leaves the pool as it was.
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function addAllSuggestions() {
    if (!suggestions) return;
    const ids = suggestions.map((c) => c.oracle_id).filter((id) => !selectedSet.has(id));
    setSelected((prev) => [...prev, ...ids]);
  }

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const base = f ? pool.pool.filter((c) => c.name.toLowerCase().includes(f)) : pool.pool;
    if (!showSuggestions || suggestionById.size === 0) return base;
    // Suggested cards float to the top.
    return [...base].sort((a, b) => Number(!suggestionById.has(a.oracle_id)) - Number(!suggestionById.has(b.oracle_id)));
  }, [pool.pool, filter, showSuggestions, suggestionById]);
  const shown = filtered.slice(0, limit);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const remove = (id: string) => setSelected((prev) => prev.filter((x) => x !== id));

  async function save() {
    if (!deck || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const saved = savedId
        ? await api.updateSavedDeck(savedId, { name: name.trim(), deck })
        : await api.saveDeck(name.trim(), deck);
      setSavedId(saved.id);
      setSavedAs(saved.name);
      onSaved?.(saved);
    } catch (e) {
      if (isPremiumRequired(e)) router.push("/paywall");
      else setError(e instanceof Error ? e.message : "Failed to save deck");
    } finally {
      setSaving(false);
    }
  }

  const sections = useMemo(
    () =>
      deck
        ? SLOTS.map((s) => ({ ...s, cards: deck.cards.filter((c) => c.slot === s.key) })).filter((s) => s.cards.length)
        : [],
    [deck],
  );
  const total = selected.length;

  return (
    <View className="gap-3">
      {/* Name + save */}
      <View className="flex-row items-center gap-2">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Deck name"
          placeholderTextColor="#64748b"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
        />
        <TouchableOpacity
          onPress={save}
          disabled={!deck || saving || !name.trim() || composing}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 disabled:opacity-50"
          activeOpacity={0.7}
        >
          <Text className="text-sm font-medium text-white">{saving ? "…" : savedId ? "Update" : "Save"}</Text>
        </TouchableOpacity>
      </View>
      {savedAs && <Text className="text-xs text-emerald-400">Saved as "{savedAs}"</Text>}
      {error && <Text className="text-xs text-rose-400">{error}</Text>}

      {/* Pool | Deck */}
      <View className="flex-row rounded-lg border border-slate-700 p-0.5">
        {(["pool", "deck"] as const).map((p) => (
          <TouchableOpacity
            key={p}
            onPress={() => setPane(p)}
            className={"flex-1 rounded-md py-2 " + (pane === p ? "bg-slate-800" : "")}
            activeOpacity={0.7}
          >
            <Text className={"text-center text-sm " + (pane === p ? "text-white" : "text-slate-400")}>
              {p === "pool" ? `Pool (${pool.pool_size.toLocaleString()})` : `Deck (${total}/99)`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {pane === "pool" ? (
        <View className="rounded-xl border border-slate-800 bg-slate-900/60">
          <View className="gap-2 border-b border-slate-800 p-3">
            <View className="flex-row items-center gap-2">
              <TextInput
                value={filter}
                onChangeText={(t) => {
                  setFilter(t);
                  setLimit(PAGE);
                }}
                placeholder="Filter by name…"
                placeholderTextColor="#64748b"
                autoCorrect={false}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
              />
              <TouchableOpacity
                onPress={fetchSuggestions}
                disabled={loadingSuggestions}
                className="rounded-lg border border-sky-700 px-3 py-1.5 disabled:opacity-50"
                activeOpacity={0.7}
              >
                <Text className="text-xs text-sky-300">
                  {loadingSuggestions ? "Thinking…" : showSuggestions ? "Refresh" : "Get suggestions"}
                </Text>
              </TouchableOpacity>
            </View>
            {showSuggestions && suggestions && (
              <View className="flex-row items-center justify-between rounded-lg bg-sky-950/40 px-3 py-2">
                <Text className="flex-1 text-xs text-sky-300">
                  {suggestions.length} cards suggested
                  {theme?.trim() ? ` for "${theme.trim()}"` : ""}
                  {strategy && strategy !== "Balanced" ? ` (${strategy})` : ""}
                </Text>
                <Text onPress={addAllSuggestions} className="ml-3 text-xs font-medium text-sky-200">
                  Add all
                </Text>
                <Text onPress={() => setShowSuggestions(false)} className="ml-3 text-xs text-slate-400">
                  Hide
                </Text>
              </View>
            )}
          </View>
          {shown.map((c) => {
            const added = selectedSet.has(c.oracle_id);
            const sug = showSuggestions ? suggestionById.get(c.oracle_id) : undefined;
            return (
              <View
                key={c.oracle_id}
                className={"flex-row items-center gap-2 border-b border-slate-800/60 px-3 py-2 " + (sug && !added ? "bg-sky-950/20" : "")}
              >
                <TouchableOpacity onPress={() => onOpenCard(c)} activeOpacity={0.6} className="flex-1">
                  <Text className="text-sm text-slate-200" numberOfLines={1}>
                    {sug && !added ? <Text className="text-sky-400">* </Text> : null}
                    {c.name}
                  </Text>
                  <Text className="text-xs text-slate-500" numberOfLines={1}>
                    {sug && !added
                      ? sug.slot === "game_plan"
                        ? sug.reason.split(" (")[0]
                        : sug.slot.replace("_", " ")
                      : shortType(c.type_line)}
                  </Text>
                </TouchableOpacity>
                <ManaCost cost={c.mana_cost} size={12} />
                <TouchableOpacity
                  onPress={() => toggle(c.oracle_id)}
                  activeOpacity={0.7}
                  className={"w-16 items-center rounded px-2 py-1 " + (added ? "bg-emerald-600/20" : "border border-slate-700")}
                >
                  <Text className={"text-xs font-medium " + (added ? "text-emerald-400" : "text-slate-300")}>
                    {added ? "Added" : "+ Add"}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <View className="flex-row items-center justify-between px-3 py-2">
            <Text className="text-xs text-slate-500">
              Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
            </Text>
            {filtered.length > shown.length && (
              <Text onPress={() => setLimit((l) => l + PAGE)} className="text-xs text-emerald-400">
                Show more
              </Text>
            )}
          </View>
        </View>
      ) : total === 0 ? (
        <View className="rounded-xl border border-dashed border-slate-800 p-6">
          <Text className="text-center text-sm text-slate-500">Add cards from the pool to start building.</Text>
          <Text className="mt-2 text-center text-sm text-slate-500">
            Use Get suggestions to see what the auto-builder recommends
            {theme?.trim() ? ` for your "${theme.trim()}" theme` : ""}.
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          <View className="flex-row gap-2">
            <StatTile label="Cards" value={`${total}/99`} />
            <StatTile label="Lands" value={deck?.land_count ?? "…"} />
          </View>
          <View className="flex-row gap-2">
            <StatTile label="Avg MV" value={deck?.stats.avg_nonland_mv ?? "…"} />
            <StatTile label="2+ lands" value={deck ? `${deck.stats.p_2plus_lands_opening}%` : "…"} />
          </View>
          {deck?.bracket && <BracketBadge bracket={deck.bracket} />}
          {deck && <ManaCurve curve={deck.curve} />}
          {deck && deck.warnings.length > 0 && (
            <View className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
              {deck.warnings.map((w, i) => (
                <Text key={i} className="text-xs text-amber-300">
                  {w}
                </Text>
              ))}
            </View>
          )}
          {composing && (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#64748b" />
              <Text className="text-xs text-slate-500">Updating…</Text>
            </View>
          )}
          {sections.map((s) => (
            <View key={s.key}>
              <View className="mb-1 flex-row items-center gap-2">
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                <Text className="text-sm font-semibold text-slate-200">
                  {s.label} ({s.cards.reduce((n, c) => n + c.count, 0)})
                </Text>
              </View>
              {s.cards.map((card, i) => {
                // Basics are added by the engine, not picked — nothing to remove.
                const removable = selectedSet.has(card.oracle_id);
                return (
                  <View key={`${card.oracle_id}#${i}`} className="flex-row items-center gap-2 border-b border-slate-800/50 py-1.5">
                    <TouchableOpacity onPress={() => onOpenCard(card)} activeOpacity={0.6} className="flex-1">
                      <Text className="text-sm text-slate-200" numberOfLines={1}>
                        {card.count > 1 && <Text className="text-slate-500">{card.count}× </Text>}
                        {card.name}
                      </Text>
                    </TouchableOpacity>
                    <ManaCost cost={card.mana_cost} size={12} />
                    {removable && (
                      <TouchableOpacity
                        onPress={() => remove(card.oracle_id)}
                        hitSlop={6}
                        accessibilityLabel={`Remove ${card.name}`}
                        activeOpacity={0.6}
                        className="h-6 w-6 items-center justify-center rounded-full border border-slate-700"
                      >
                        <Text className="text-xs text-slate-400">−</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
          {commanderName ? (
            <DeckComboFinishers
              commanderName={commanderName}
              deckCardIds={selected}
              maxPrice={maxPrice}
              defaultOpen
              onOpenCard={onOpenCard}
              onAdd={(id) => setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]))}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
