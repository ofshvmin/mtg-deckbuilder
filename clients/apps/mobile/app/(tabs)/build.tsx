import { useEffect, useState } from "react";
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
} from "react-native";
import type { BriefDeckResponse, CommanderOption, GeneratedDeck, StrategyOption } from "@mtg/shared";
import { api } from "../../src/lib/api";
import DeckDetailModal from "../../src/components/DeckDetailModal";

type Mode = "auto" | "brief";
type BriefTurn = { role: "user" | "assistant"; text: string };

export default function BuildScreen() {
  // Commander search
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CommanderOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [commander, setCommander] = useState<CommanderOption | null>(null);

  // Pool + build
  const [loadingPool, setLoadingPool] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolReady, setPoolReady] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [deck, setDeck] = useState<GeneratedDeck | null>(null);
  const [deckName, setDeckName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeckDetail, setShowDeckDetail] = useState(false);

  // Mode + strategy
  const [mode, setMode] = useState<Mode>("auto");
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState("Balanced");
  const [theme, setTheme] = useState("");

  // AI brief
  const [briefText, setBriefText] = useState("");
  const [briefing, setBriefing] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [briefResult, setBriefResult] = useState<BriefDeckResponse | null>(null);
  const [conversation, setConversation] = useState<BriefTurn[]>([]);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);

  useEffect(() => {
    api.listStrategies().then(setStrategies).catch(() => {});
  }, []);

  // Commander search with debounce
  useEffect(() => {
    if (query.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      setSearching(true);
      api.searchCommanders(query, 8)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function selectCommander(c: CommanderOption) {
    setCommander(c);
    setQuery(c.name);
    setSuggestions([]);
    setDeck(null);
    setBriefResult(null);
    setConversation([]);
    setPoolReady(false);
    setLoadingPool(true);
    setPoolError(null);
    setSaved(false);
    try {
      await api.getPool(c.name); // validates pool exists
      setPoolReady(true);
      setDeckName(`${c.name} Deck`);
    } catch (e) {
      setPoolError(e instanceof Error ? e.message : "Could not load pool");
    } finally {
      setLoadingPool(false);
    }
  }

  async function buildDeck() {
    if (!commander) return;
    setBuilding(true);
    setBuildError(null);
    setSaved(false);
    try {
      const opts: { strategy?: string; theme?: string } = {};
      if (selectedStrategy !== "Balanced") opts.strategy = selectedStrategy;
      if (theme.trim()) opts.theme = theme.trim();
      const d = await api.generateDeck(commander.name, opts);
      setDeck(d);
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setBuilding(false);
    }
  }

  async function submitBrief() {
    if (!commander || !briefText.trim()) return;
    setBriefing(true);
    setBriefError(null);
    setSaved(false);
    try {
      const request = briefText.trim();
      const res = await api.briefDeck(commander.name, request);
      setBriefResult(res);
      setDeck(res.deck);
      setConversation([
        { role: "user", text: request },
        { role: "assistant", text: res.rationale },
      ]);
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : "AI brief failed");
    } finally {
      setBriefing(false);
    }
  }

  // Conversational refinement: adjust the current brief-built deck.
  async function submitRefine() {
    const instruction = refineText.trim();
    if (!commander || !briefResult || refining || !instruction) return;
    setRefining(true);
    setRefineText("");
    setSaved(false);
    setConversation((c) => [...c, { role: "user", text: instruction }]);
    try {
      const priorSpec = {
        ...briefResult.spec,
        core_cards: briefResult.core_cards.map((c) => c.name),
      };
      const res = await api.briefDeck(commander.name, instruction, priorSpec);
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
    if (!deck || saving) return;
    setSaving(true);
    try {
      await api.saveDeck(deckName.trim() || `${commander?.name} Deck`, deck);
      setSaved(true);
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-slate-950">
      <ScrollView className="flex-1 px-4 py-4" keyboardShouldPersistTaps="handled">
        {/* Commander search */}
        <Text className="mb-2 text-sm font-medium text-slate-300">Commander</Text>
        <TextInput
          value={query}
          onChangeText={(t) => { setQuery(t); if (commander) setCommander(null); }}
          placeholder="Search your commanders…"
          placeholderTextColor="#64748b"
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
        />
        {searching && <ActivityIndicator size="small" color="#64748b" className="mt-2" />}

        {suggestions.length > 0 && !commander && (
          <View className="mt-1 rounded-lg border border-slate-700 bg-slate-800">
            {suggestions.map((c) => (
              <TouchableOpacity
                key={c.oracle_id}
                onPress={() => selectCommander(c)}
                className="border-b border-slate-700/50 px-3 py-2.5"
                activeOpacity={0.6}
              >
                <Text className="text-sm text-slate-200">{c.name}</Text>
                <Text className="text-xs text-slate-500">
                  {c.color_identity.join("") || "C"} · {c.type_line}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loadingPool && <Text className="mt-4 text-sm text-slate-400">Loading pool…</Text>}
        {poolError && <Text className="mt-4 text-sm text-rose-400">{poolError}</Text>}

        {poolReady && commander && !deck && (
          <View className="mt-6 gap-4">
            {/* Commander selected */}
            <View className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <Text className="text-lg font-semibold text-white">{commander.name}</Text>
              <Text className="text-sm text-slate-400">
                {commander.color_identity.join("") || "C"} · {commander.type_line}
              </Text>
            </View>

            {/* Mode toggle */}
            <View className="flex-row rounded-lg border border-slate-700 p-0.5">
              <TouchableOpacity
                onPress={() => setMode("auto")}
                className={"flex-1 rounded-md py-2 " + (mode === "auto" ? "bg-slate-800" : "")}
                activeOpacity={0.7}
              >
                <Text className={"text-center text-sm " + (mode === "auto" ? "text-white" : "text-slate-400")}>
                  Auto-build
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMode("brief")}
                className={"flex-1 rounded-md py-2 " + (mode === "brief" ? "bg-slate-800" : "")}
                activeOpacity={0.7}
              >
                <Text className={"text-center text-sm " + (mode === "brief" ? "text-white" : "text-slate-400")}>
                  Describe
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "auto" ? (
              <View className="gap-4">
                {/* Strategy picker */}
                {strategies.length > 0 && (
                  <View>
                    <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                      Strategy
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2">
                        {strategies.map((s) => (
                          <TouchableOpacity
                            key={s.name}
                            onPress={() => setSelectedStrategy(s.name)}
                            className={
                              "rounded-lg border px-3 py-1.5 " +
                              (selectedStrategy === s.name
                                ? "border-emerald-600 bg-emerald-600/20"
                                : "border-slate-700")
                            }
                            activeOpacity={0.7}
                          >
                            <Text className={
                              "text-sm " +
                              (selectedStrategy === s.name ? "text-emerald-300" : "text-slate-400")
                            }>
                              {s.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {/* Theme */}
                <View>
                  <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                    Theme (optional)
                  </Text>
                  <TextInput
                    value={theme}
                    onChangeText={setTheme}
                    placeholder="e.g. cats, landfall, zombies…"
                    placeholderTextColor="#64748b"
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
                  />
                </View>

                {/* Build button */}
                <TouchableOpacity
                  onPress={buildDeck}
                  disabled={building}
                  className="rounded-lg bg-emerald-600 py-3 disabled:opacity-50"
                  activeOpacity={0.7}
                >
                  {building ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-center text-sm font-semibold text-white">
                      Build 99-card deck
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View className="gap-3">
                <Text className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Describe the deck you want
                </Text>
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
                    <Text className="text-center text-sm font-semibold text-white">
                      Build from description
                    </Text>
                  )}
                </TouchableOpacity>
                {briefError && <Text className="text-sm text-rose-400">{briefError}</Text>}
                <Text className="text-xs text-slate-500">
                  Claude picks the core cards from your collection; the engine builds the rest.
                </Text>
              </View>
            )}

            {buildError && <Text className="text-sm text-rose-400">{buildError}</Text>}
          </View>
        )}

        {/* Deck result — show rationale then open deck view */}
        {deck && commander && (
          <View className="mt-6 gap-4">
            {briefResult && (
              <View className="rounded-xl border border-indigo-800/40 bg-indigo-950/30 p-4">
                {/* Conversation transcript */}
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

                {/* Refine input */}
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
                <Text className="text-sm font-medium text-white">
                  {saving ? "…" : saved ? "Saved" : "Save"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Quick stats */}
            <View className="flex-row gap-3">
              <QuickStat label="Total" value={deck.total} />
              <QuickStat label="Lands" value={deck.land_count} />
              <QuickStat label="Avg MV" value={deck.stats.avg_nonland_mv?.toFixed(1) ?? "—"} />
              {deck.bracket && <QuickStat label="Bracket" value={deck.bracket.bracket} />}
            </View>

            {/* View full deck button */}
            <TouchableOpacity
              onPress={() => setShowDeckDetail(true)}
              className="rounded-lg border border-slate-700 py-3"
              activeOpacity={0.7}
            >
              <Text className="text-center text-sm text-slate-200">View Full Deck</Text>
            </TouchableOpacity>

            {showDeckDetail && (
              <DeckDetailModal deck={deck} name={deckName || `${commander.name} Deck`} onClose={() => setShowDeckDetail(false)} />
            )}
          </View>
        )}

        <View className="h-20" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function QuickStat({ label, value }: { label: string; value: string | number }) {
  return (
    <View className="flex-1 rounded-lg border border-slate-800 bg-slate-900/60 p-3 items-center">
      <Text className="text-lg font-bold text-white">{value}</Text>
      <Text className="text-xs text-slate-500">{label}</Text>
    </View>
  );
}
