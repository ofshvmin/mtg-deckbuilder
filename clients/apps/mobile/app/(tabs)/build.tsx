import { useEffect, useState } from "react";
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  isPremiumRequired,
  type BriefDeckResponse,
  type Color,
  type ColorRationale,
  type CommanderFilters,
  type CommanderOption,
  type DeckFormat,
  type GeneratedDeck,
  type PoolFilters,
  type PoolResponse,
  type PoolScope,
  type StrategyOption,
} from "@mtg/shared";
import { api } from "../../src/lib/api";
import { usePremium } from "../../src/purchases/PremiumContext";
import DeckView from "../../src/components/DeckView";
import PoolControls from "../../src/components/PoolControls";
import CommanderFilterBar, { hasCommanderFilters } from "../../src/components/CommanderFilterBar";
import CardDetailModal from "../../src/components/CardDetailModal";
import ColorPicker from "../../src/components/ColorPicker";
import LegalPoolList from "../../src/components/LegalPoolList";
import ManualBuilder from "../../src/components/ManualBuilder";
import { ManaCurve, StatTile } from "../../src/components/DeckStats";
import { ColorPips } from "../../src/components/ManaSymbols";

// The Build tab, matching the web's Build page: pick a format; for Commander,
// pick a commander; the legal pool loads; then auto-build, describe the deck to
// Claude, or build it by hand. Standard and Legacy need no commander — choosing
// the format is enough to build — and add a color picker.
//
// "Edit cards" on a deck (here or on the Decks tab) reopens it in the manual
// builder. The Decks tab arrives with `?edit=<deck id>`.

type Mode = "auto" | "manual" | "brief";
type BriefTurn = { role: "user" | "assistant"; text: string };
type EditSeed = { selected: string[]; deckId?: string; deckName?: string };
type DetailCard = { oracle_id?: string; name: string; mana_cost?: string; type_line?: string; color_identity?: Color[] };

export default function BuildScreen() {
  const { isPremium } = usePremium();
  const { edit } = useLocalSearchParams<{ edit?: string }>();

  // Format
  const [formats, setFormats] = useState<DeckFormat[]>([]);
  const [format, setFormat] = useState("commander");
  const spec = formats.find((f) => f.key === format);
  const needsCommander = spec ? spec.requires_commander : true;

  // Commander search
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CommanderOption[]>([]);
  const [commanderFilters, setCommanderFilters] = useState<CommanderFilters>({});
  const [noMatch, setNoMatch] = useState(false);
  const [searching, setSearching] = useState(false);
  const [commander, setCommander] = useState<CommanderOption | null>(null);

  // Pool
  const [pool, setPool] = useState<PoolResponse | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolScope, setPoolScope] = useState<PoolScope>("owned");
  const [poolSets, setPoolSets] = useState<string[]>([]);
  // The commander the pool is for, kept apart from `pool`: a filter can narrow the
  // pool to nothing, and the target has to survive that so the filter can be widened.
  const [poolCommander, setPoolCommander] = useState<string | null>(null);
  const hasTarget = !needsCommander || poolCommander !== null;

  // Build
  const [mode, setMode] = useState<Mode>("auto");
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [theme, setTheme] = useState("");
  const [colors, setColors] = useState<string[]>([]);
  const [autoFillColors, setAutoFillColors] = useState(true);
  const [colorRationale, setColorRationale] = useState<ColorRationale | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [deck, setDeck] = useState<GeneratedDeck | null>(null);
  const [deckName, setDeckName] = useState("");
  const [saving, setSaving] = useState(false);
  // The saved deck's id once saved, so the deck view updates it rather than
  // saving a second copy.
  const [savedId, setSavedId] = useState<string | null>(null);
  const saved = savedId !== null;
  const [showDeckDetail, setShowDeckDetail] = useState(false);
  const [editSeed, setEditSeed] = useState<EditSeed | null>(null);
  const [detail, setDetail] = useState<DetailCard | null>(null);

  // AI brief
  const [briefText, setBriefText] = useState("");
  const [briefing, setBriefing] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [briefResult, setBriefResult] = useState<BriefDeckResponse | null>(null);
  const [conversation, setConversation] = useState<BriefTurn[]>([]);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);

  const poolFilters: PoolFilters = {
    pool_scope: poolScope,
    ...(poolSets.length > 0 ? { sets: poolSets } : {}),
  };

  useEffect(() => {
    api.listFormats().then(setFormats).catch(() => {});
  }, []);

  // Strategy tables differ per format (Commander is EDH-tuned), so refetch and
  // reset the selection whenever the format changes.
  useEffect(() => {
    api
      .listStrategies(format)
      .then((list) => {
        setStrategies(list);
        setSelectedStrategy(list[0]?.name ?? "");
      })
      .catch(() => {});
  }, [format]);

  // Commander search with debounce. Filters alone are enough to browse, so a
  // name is only required when nothing else narrows the list.
  const filtering = hasCommanderFilters(commanderFilters);
  useEffect(() => {
    if (commander || !needsCommander) return;
    setNoMatch(false);
    if (query.length < 2 && !filtering) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      api
        .searchCommanders(query, filtering ? 40 : 8, commanderFilters)
        .then((found) => {
          setSuggestions(found);
          setNoMatch(found.length === 0);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, commanderFilters, commander, needsCommander]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Edit cards" from the Decks tab: load the saved deck into the manual builder.
  useEffect(() => {
    if (!edit) return;
    router.setParams({ edit: undefined });
    void (async () => {
      try {
        const savedDeck = await api.getSavedDeck(edit);
        if (!savedDeck.deck.commander) return;
        await startEditing(savedDeck.deck, savedDeck.id, savedDeck.name);
      } catch (e) {
        setPoolError(e instanceof Error ? e.message : "Couldn't open that deck for editing");
      }
    })();
  }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetBuild() {
    setPool(null);
    setDeck(null);
    setEditSeed(null);
    setBriefResult(null);
    setConversation([]);
    setBriefText("");
    setBuildError(null);
    setBriefError(null);
    setSavedId(null);
  }

  /** Load the pool for the current target (commander, or a commander-free format). */
  async function loadPool(opts: {
    commanderName?: string | null;
    fmt?: string;
    scope?: PoolScope;
    sets?: string[];
    excludeDeckId?: string;
  }) {
    const scope = opts.scope ?? poolScope;
    const sets = opts.sets ?? poolSets;
    setLoadingPool(true);
    setPoolError(null);
    try {
      setPool(
        await api.getPool({
          ...(opts.commanderName ? { commander: opts.commanderName } : {}),
          format: opts.fmt ?? format,
          pool_scope: scope,
          ...(sets.length > 0 ? { sets } : {}),
          ...(opts.excludeDeckId ? { exclude_deck_id: opts.excludeDeckId } : {}),
        }),
      );
    } catch (e) {
      setPool(null);
      setPoolError(e instanceof Error ? e.message : "Could not load pool");
    } finally {
      setLoadingPool(false);
    }
  }

  // Switching to a format with no commander loads its pool straight away —
  // pick Standard, get a deck.
  async function selectFormat(key: string) {
    if (key === format) return;
    setFormat(key);
    setColors([]);
    setColorRationale(null);
    setMode("auto");
    setDeckName("");
    resetCommander();
    const next = formats.find((f) => f.key === key);
    if (next && !next.requires_commander) await loadPool({ fmt: key });
  }

  async function selectCommander(c: CommanderOption) {
    setCommander(c);
    setQuery(c.name);
    setSuggestions([]);
    resetBuild();
    setMode("auto");
    setPoolCommander(c.name);
    setDeckName(`${c.name} Deck`);
    await loadPool({ commanderName: c.name });
  }

  async function applyPoolFilters(next: { scope?: PoolScope; sets?: string[] }) {
    if (next.scope !== undefined) setPoolScope(next.scope);
    if (next.sets !== undefined) setPoolSets(next.sets);
    setDeck(null);
    if (hasTarget) await loadPool({ commanderName: poolCommander, ...next, excludeDeckId: editSeed?.deckId });
  }

  function resetCommander() {
    setQuery("");
    setCommander(null);
    setSuggestions([]);
    setPoolCommander(null);
    resetBuild();
  }

  /** Reopen a deck's cards in the manual builder (its commander's pool, its own
   *  copies counted as free). */
  async function startEditing(built: GeneratedDeck, deckId?: string, name?: string) {
    const cmd = built.commander;
    if (!cmd) return;
    setShowDeckDetail(false);
    if (format !== "commander") setFormat("commander");
    setCommander({
      oracle_id: cmd.oracle_id,
      name: cmd.name,
      type_line: cmd.type_line,
      color_identity: built.color_identity,
      image_uris: cmd.image_uris,
    });
    setQuery(cmd.name);
    setSuggestions([]);
    setPoolCommander(cmd.name);
    setDeck(null);
    setBriefResult(null);
    setConversation([]);
    setEditSeed({
      selected: built.cards.filter((c) => !c.oracle_id.startsWith("basic:")).map((c) => c.oracle_id),
      deckId,
      deckName: name,
    });
    setMode("manual");
    await loadPool({ commanderName: cmd.name, fmt: "commander", excludeDeckId: deckId });
  }

  async function buildDeck(override?: { colors?: string[]; autoFill?: boolean }) {
    if (!pool) return;
    setBuilding(true);
    setBuildError(null);
    setSavedId(null);
    setBriefResult(null);
    setConversation([]);
    try {
      const built = await api.generateDeck(pool.commander?.name ?? null, {
        format,
        ...poolFilters,
        ...(selectedStrategy && selectedStrategy !== strategies[0]?.name ? { strategy: selectedStrategy } : {}),
        ...(theme.trim() ? { theme: theme.trim() } : {}),
        ...(!needsCommander
          ? { colors: override?.colors ?? colors, auto_fill_colors: override?.autoFill ?? autoFillColors }
          : {}),
      });
      setDeck(built);
      if (!needsCommander && !deckName.trim()) setDeckName(`${spec?.label ?? "New"} Deck`);
      // An explicit color choice comes back with no alternates, so keep the last
      // set that had them — otherwise picking one strands you there.
      setColorRationale((prev) => {
        const next = built.color_rationale ?? null;
        if (next && next.alternates.length > 0) return next;
        return prev ?? next;
      });
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setBuilding(false);
    }
  }

  async function submitBrief() {
    if (!pool || !briefText.trim()) return;
    setBriefing(true);
    setBriefError(null);
    setSavedId(null);
    try {
      const request = briefText.trim();
      const res = await api.briefDeck(pool.commander?.name ?? null, request, undefined, format, poolFilters);
      setBriefResult(res);
      setDeck(res.deck);
      if (!deckName.trim()) setDeckName(`${spec?.label ?? "New"} Deck`);
      setConversation([
        { role: "user", text: request },
        { role: "assistant", text: res.rationale },
      ]);
    } catch (e) {
      if (isPremiumRequired(e)) router.push("/paywall");
      else setBriefError(e instanceof Error ? e.message : "AI brief failed");
    } finally {
      setBriefing(false);
    }
  }

  // Conversational refinement: adjust the current brief-built deck.
  async function submitRefine() {
    const instruction = refineText.trim();
    if (!pool || !briefResult || refining || !instruction) return;
    setRefining(true);
    setRefineText("");
    setSavedId(null);
    setConversation((c) => [...c, { role: "user", text: instruction }]);
    try {
      const priorSpec = { ...briefResult.spec, core_cards: briefResult.core_cards.map((c) => c.name) };
      const res = await api.briefDeck(pool.commander?.name ?? null, instruction, priorSpec, format, poolFilters);
      setBriefResult(res);
      setDeck(res.deck);
      setConversation((c) => [...c, { role: "assistant", text: res.rationale }]);
    } catch (e) {
      setConversation((c) => [
        ...c,
        { role: "assistant", text: `Couldn't refine: ${e instanceof Error ? e.message : "error"}` },
      ]);
    } finally {
      setRefining(false);
    }
  }

  async function handleSave() {
    if (!deck || saving || !deckName.trim()) return;
    setSaving(true);
    try {
      const res = await api.saveDeck(deckName.trim(), deck);
      setSavedId(res.id);
    } catch (e) {
      // 402 => hit the free-tier saved-deck cap; surface the paywall.
      if (isPremiumRequired(e)) router.push("/paywall");
    } finally {
      setSaving(false);
    }
  }

  const sectionLabel = "mb-2 text-xs font-medium uppercase tracking-wider text-slate-400";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-slate-950">
      <ScrollView className="flex-1 px-4 py-4" keyboardShouldPersistTaps="handled">
        {/* Format */}
        {formats.length > 0 && (
          <View className="mb-5">
            <Text className={sectionLabel}>Format</Text>
            <View className="flex-row rounded-lg border border-slate-700 p-0.5">
              {formats.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => void selectFormat(f.key)}
                  className={"flex-1 rounded-md py-2 " + (format === f.key ? "bg-slate-800" : "")}
                  activeOpacity={0.7}
                >
                  {/* "Legacy — any card you own": the name in the switch, the gloss below. */}
                  <Text className={"text-center text-sm " + (format === f.key ? "text-white" : "text-slate-400")}>
                    {f.label.split(" — ")[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {spec && (
              <Text className="mt-1.5 text-xs text-slate-500">
                {spec.label.includes(" — ") ? `${capitalize(spec.label.split(" — ")[1])} · ` : ""}
                {spec.deck_size} cards · up to {spec.max_copies} cop{spec.max_copies === 1 ? "y" : "ies"} of each
              </Text>
            )}
          </View>
        )}

        {/* Commander search */}
        {needsCommander && (
          <>
            <Text className="mb-2 text-sm font-medium text-slate-300">Commander</Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={query}
                onChangeText={(t) => {
                  setQuery(t);
                  if (commander) {
                    setCommander(null);
                    setPoolCommander(null);
                    resetBuild();
                  }
                }}
                placeholder="Search your commanders…"
                placeholderTextColor="#64748b"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={resetCommander} hitSlop={8} className="px-2 py-2" activeOpacity={0.6}>
                  <Text className="text-lg text-slate-400">✕</Text>
                </TouchableOpacity>
              )}
            </View>
            {!commander && <CommanderFilterBar filters={commanderFilters} onChange={setCommanderFilters} />}
            {searching && <ActivityIndicator size="small" color="#64748b" className="mt-2" />}
            {!searching && !commander && filtering && noMatch && (
              <Text className="mt-2 text-sm text-slate-500">No owned commanders match these filters.</Text>
            )}
            {suggestions.length > 0 && !commander && (
              <View className="mt-1 rounded-lg border border-slate-700 bg-slate-800">
                {suggestions.map((c) => (
                  <TouchableOpacity
                    key={c.oracle_id}
                    onPress={() => void selectCommander(c)}
                    className="border-b border-slate-700/50 px-3 py-2.5"
                    activeOpacity={0.6}
                  >
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-1">
                        <Text className="text-sm text-slate-200">{c.name}</Text>
                        <Text className="text-xs text-slate-500" numberOfLines={1}>
                          {c.type_line}
                        </Text>
                      </View>
                      <ColorPips colors={c.color_identity} size={15} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        {/* Pool scope + sets. Outside the pool block on purpose: a filter can
            narrow the pool to nothing, and the control that did it has to stay
            on screen to undo it. */}
        {hasTarget && !deck && (
          <View className="mt-6">
            <PoolControls
              scope={poolScope}
              onScopeChange={(next) => void applyPoolFilters({ scope: next })}
              sets={poolSets}
              onSetsChange={(next) => void applyPoolFilters({ sets: next })}
              disabled={loadingPool || building}
            />
          </View>
        )}

        {loadingPool && <Text className="mt-4 text-sm text-slate-400">Building your legal pool…</Text>}
        {poolError && <Text className="mt-4 text-sm text-rose-400">{poolError}</Text>}

        {pool && !deck && (
          <View className="mt-6 gap-4">
            {/* Commander selected */}
            {pool.commander && (
              <View className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <Text className="text-lg font-semibold text-white">{pool.commander.name}</Text>
                <View className="mt-0.5 flex-row items-center gap-1.5">
                  <ColorPips colors={pool.color_identity} size={15} />
                  <Text className="shrink text-sm text-slate-400" numberOfLines={1}>
                    · {pool.commander.type_line}
                  </Text>
                </View>
                <Text className="mt-1 text-xs text-slate-500">
                  {pool.pool_size.toLocaleString()} cards in pool
                  {poolScope === "available" ? " (available)" : ""}
                  {poolSets.length > 0 && ` · ${poolSets.length} set${poolSets.length === 1 ? "" : "s"}`}
                </Text>
              </View>
            )}

            {editSeed?.deckName && (
              <Text className="text-xs text-amber-300">Editing "{editSeed.deckName}" — Update saves over it.</Text>
            )}

            {/* Mode toggle */}
            <View className="flex-row rounded-lg border border-slate-700 p-0.5">
              {(
                [
                  ["auto", "Auto-build"],
                  ...(needsCommander ? [["manual", "Manually"]] : []),
                  ["brief", "Describe"],
                ] as [Mode, string][]
              ).map(([m, label]) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => (m === "brief" && !isPremium ? router.push("/paywall") : setMode(m))}
                  className={"flex-1 rounded-md py-2 " + (mode === m ? "bg-slate-800" : "")}
                  activeOpacity={0.7}
                >
                  <Text className={"text-center text-sm " + (mode === m ? "text-white" : "text-slate-400")}>
                    {label}
                    {m === "brief" && !isPremium ? <Text className="text-amber-400"> ✦</Text> : null}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Strategy — Claude sets it in brief mode */}
            {mode !== "brief" && strategies.length > 0 && (
              <View>
                <Text className={sectionLabel}>Strategy</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {strategies.map((s) => (
                      <TouchableOpacity
                        key={s.name}
                        onPress={() => setSelectedStrategy(s.name)}
                        className={
                          "rounded-lg border px-3 py-1.5 " +
                          (selectedStrategy === s.name ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700")
                        }
                        activeOpacity={0.7}
                      >
                        <Text className={"text-sm " + (selectedStrategy === s.name ? "text-emerald-300" : "text-slate-400")}>
                          {s.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                {selectedStrategy && selectedStrategy !== strategies[0]?.name && (
                  <Text className="mt-1.5 text-xs text-slate-500">
                    {strategies.find((s) => s.name === selectedStrategy)?.description}
                  </Text>
                )}
              </View>
            )}

            {/* Colors — formats without a commander only */}
            {!needsCommander && (
              <ColorPicker
                colors={colors}
                onChange={setColors}
                autoFill={autoFillColors}
                onAutoFillChange={setAutoFillColors}
                maxColors={spec?.max_deck_colors ?? 3}
                rationale={colorRationale}
                onPickAlternate={(next) => {
                  setColors(next);
                  setAutoFillColors(false);
                  void buildDeck({ colors: next, autoFill: false });
                }}
              />
            )}

            {/* Theme — Claude sets it in brief mode */}
            {mode !== "brief" && (
              <View>
                <Text className={sectionLabel}>Theme (optional)</Text>
                <TextInput
                  value={theme}
                  onChangeText={setTheme}
                  placeholder="e.g. cats, landfall, zombies, Urza, tokens…"
                  placeholderTextColor="#64748b"
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
                />
                <Text className="mt-1.5 text-xs text-slate-500">
                  Matches card names, creature types, and oracle text.
                </Text>
              </View>
            )}

            {mode === "auto" && (
              <>
                <TouchableOpacity
                  onPress={() => void buildDeck()}
                  disabled={building}
                  className="rounded-lg bg-emerald-600 py-3 disabled:opacity-50"
                  activeOpacity={0.7}
                >
                  {building ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-center text-sm font-semibold text-white">
                      Build {spec?.deck_size ?? 99}-card deck
                    </Text>
                  )}
                </TouchableOpacity>
                {buildError && <Text className="text-sm text-rose-400">{buildError}</Text>}

                {/* Pool view */}
                <View className="flex-row gap-2">
                  <StatTile label="Legal pool" value={pool.pool_size.toLocaleString()} />
                  <StatTile label="Lands" value={pool.land_count} />
                </View>
                <View className="flex-row gap-2">
                  <StatTile label="Nonlands" value={(pool.pool_size - pool.land_count).toLocaleString()} />
                  <StatTile
                    label="Colors"
                    value={
                      needsCommander ? (
                        <ColorPips colors={pool.color_identity} size={20} />
                      ) : colors.length ? (
                        <ColorPips colors={colors as Color[]} size={20} />
                      ) : (
                        "Auto"
                      )
                    }
                  />
                </View>
                <ManaCurve curve={pool.curve} />
                <LegalPoolList pool={pool.pool} onOpenCard={setDetail} />
              </>
            )}

            {mode === "brief" && (
              <View className="gap-3">
                <Text className={sectionLabel}>Describe the deck you want</Text>
                <TextInput
                  value={briefText}
                  onChangeText={setBriefText}
                  placeholder="e.g. A grindy treasure-sacrifice deck focused on card advantage — no infinite combos"
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  className="min-h-[100] rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
                />
                <TouchableOpacity
                  onPress={submitBrief}
                  disabled={briefing || !briefText.trim()}
                  className="rounded-lg bg-indigo-600 py-3 disabled:opacity-50"
                  activeOpacity={0.7}
                >
                  {briefing ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-center text-sm font-semibold text-white">Build from description</Text>
                  )}
                </TouchableOpacity>
                {briefError && <Text className="text-sm text-rose-400">{briefError}</Text>}
                <Text className="text-xs text-slate-500">
                  Claude picks the core cards from your collection; the engine builds the rest.
                </Text>
              </View>
            )}

            {mode === "manual" && pool.commander && (
              <ManualBuilder
                key={editSeed?.deckId ?? (editSeed ? "edit" : `new:${pool.commander.name}`)}
                pool={pool}
                commanderName={pool.commander.name}
                strategy={selectedStrategy}
                theme={theme}
                initialSelected={editSeed?.selected}
                deckId={editSeed?.deckId}
                deckName={editSeed?.deckName}
                poolFilters={poolFilters}
                onOpenCard={(c) =>
                  setDetail({
                    oracle_id: c.oracle_id,
                    name: c.name,
                    mana_cost: c.mana_cost,
                    type_line: c.type_line,
                    color_identity: c.color_identity,
                  })
                }
              />
            )}
          </View>
        )}

        {/* Deck result */}
        {deck && pool && (
          <View className="mt-6 gap-4">
            <TouchableOpacity onPress={() => setDeck(null)} className="self-start" activeOpacity={0.6}>
              <Text className="text-sm text-slate-400">← Back to build</Text>
            </TouchableOpacity>

            {/* Colors stay live after a constructed build — a change rebuilds. */}
            {!needsCommander && (
              <ColorPicker
                colors={colors}
                onChange={(next) => {
                  setColors(next);
                  void buildDeck({ colors: next, autoFill: autoFillColors });
                }}
                autoFill={autoFillColors}
                onAutoFillChange={(next) => {
                  setAutoFillColors(next);
                  void buildDeck({ colors, autoFill: next });
                }}
                maxColors={spec?.max_deck_colors ?? 3}
                rationale={colorRationale}
                onPickAlternate={(next) => {
                  setColors(next);
                  setAutoFillColors(false);
                  void buildDeck({ colors: next, autoFill: false });
                }}
                busy={building}
              />
            )}
            {buildError && <Text className="text-sm text-rose-400">{buildError}</Text>}

            {briefResult && (
              <View className="rounded-xl border border-indigo-800/40 bg-indigo-950/30 p-4">
                <View className="gap-3">
                  {conversation.map((turn, i) => (
                    <View key={i}>
                      <Text className="text-xs font-medium uppercase tracking-wider text-indigo-300">
                        {turn.role === "user" ? "You" : "Claude"}
                      </Text>
                      <Text className="mt-1 text-sm leading-5 text-slate-300">{turn.text}</Text>
                    </View>
                  ))}
                  {refining && <ActivityIndicator size="small" color="#818cf8" />}
                </View>

                {briefResult.core_cards.length > 0 && (
                  <View className="mt-4 border-t border-indigo-800/30 pt-3">
                    <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-indigo-300">
                      Core cards ({briefResult.core_cards.length})
                    </Text>
                    <View className="flex-row flex-wrap gap-1.5">
                      {briefResult.core_cards.map((c) => (
                        <View key={c.name} className="rounded-md border border-indigo-800/50 bg-indigo-900/30 px-2 py-1">
                          <Text className="text-xs text-slate-200">{c.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                <View className="mt-4 flex-row items-center gap-2 border-t border-indigo-800/30 pt-3">
                  <TextInput
                    value={refineText}
                    onChangeText={setRefineText}
                    placeholder="Refine — e.g. lower the curve, cut combos…"
                    placeholderTextColor="#64748b"
                    editable={!refining}
                    onSubmitEditing={submitRefine}
                    returnKeyType="send"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
                  />
                  <TouchableOpacity
                    onPress={submitRefine}
                    disabled={refining || !refineText.trim()}
                    className="rounded-lg bg-indigo-600 px-3 py-2 disabled:opacity-50"
                    activeOpacity={0.7}
                  >
                    <Text className="text-sm font-medium text-white">Send</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Save controls */}
            <View className="flex-row items-center gap-2">
              <TextInput
                value={deckName}
                onChangeText={setDeckName}
                placeholder="Deck name"
                placeholderTextColor="#64748b"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
              />
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving || saved || !deckName.trim()}
                className={"rounded-lg px-4 py-2.5 " + (saved ? "bg-slate-700" : "bg-indigo-600") + " disabled:opacity-50"}
                activeOpacity={0.7}
              >
                <Text className="text-sm font-medium text-white">{saving ? "…" : saved ? "Saved" : "Save"}</Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-3">
              <QuickStat label="Total" value={deck.total} />
              <QuickStat label="Lands" value={deck.land_count} />
              <QuickStat label="Avg MV" value={deck.stats.avg_nonland_mv?.toFixed(1) ?? "—"} />
              {deck.bracket && <QuickStat label="Bracket" value={deck.bracket.bracket} />}
            </View>

            <TouchableOpacity
              onPress={() => setShowDeckDetail(true)}
              className="rounded-lg border border-slate-700 py-3"
              activeOpacity={0.7}
            >
              <Text className="text-center text-sm text-slate-200">View Full Deck</Text>
            </TouchableOpacity>

            {showDeckDetail && (
              <DeckView
                deck={deck}
                deckName={saved ? deckName.trim() : undefined}
                suggestedName={deckName}
                deckId={savedId ?? undefined}
                poolFilters={poolFilters}
                onSaved={(res) => {
                  setSavedId(res.id);
                  setDeckName(res.name);
                  setDeck(res.deck);
                }}
                onDeckChange={setDeck}
                onEdit={(d, id, name) =>
                  void startEditing(d, id ?? savedId ?? undefined, name ?? (saved ? deckName : undefined))
                }
                onClose={() => setShowDeckDetail(false)}
              />
            )}
          </View>
        )}

        <View className="h-20" />
      </ScrollView>

      <CardDetailModal card={detail} onClose={() => setDetail(null)} />
    </KeyboardAvoidingView>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function QuickStat({ label, value }: { label: string; value: string | number }) {
  return (
    <View className="flex-1 items-center rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <Text className="text-lg font-bold text-white">{value}</Text>
      <Text className="text-xs text-slate-500">{label}</Text>
    </View>
  );
}
