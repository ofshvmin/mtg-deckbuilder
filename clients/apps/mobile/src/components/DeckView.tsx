import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Modal, View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { router } from "expo-router";
import {
  cheapestPrint,
  fetchCardDetail,
  isPremiumRequired,
  type DeckCard,
  type GeneratedDeck,
  type PoolFilters,
  type SavedDeck,
} from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { exportFilename, pickExportFormat, shareCsv } from "../lib/exports";
import CommanderCard from "./CommanderCard";
import CardDetailModal from "./CardDetailModal";
import { BracketBadge, ManaCurve, StatTile } from "./DeckStats";
import { ComboSection, DeckComboFinishers, DeckUpgrades, type CardRef } from "./DeckExtras";
import { ColorPips, ManaCost } from "./ManaSymbols";
import PlaytestModal from "./PlaytestModal";
import PullListModal from "./PullListModal";

// One deck, everything the web's DeckView offers laid out for a phone: name and
// save, stats and curve, the card list by role with pin-and-regenerate, combos,
// finishers and upgrades, playtest, the pull list, mark in use, and export.
//
// Used for a freshly built deck from Build (no id until saved) and for saved
// decks from the Decks tab. Edits — a regenerate, a re-earmarked printing, a new
// name — collect as unsaved changes until Save/Update, as on the web.

const SLOTS: { key: string; label: string; color: string }[] = [
  { key: "land", label: "Lands", color: "#f59e0b" },
  { key: "ramp", label: "Ramp", color: "#10b981" },
  { key: "card_draw", label: "Card Draw", color: "#0ea5e9" },
  { key: "removal", label: "Removal", color: "#f43f5e" },
  { key: "board_wipe", label: "Board Wipes", color: "#dc2626" },
  { key: "game_plan", label: "Game Plan", color: "#d946ef" },
];

type DetailCard = {
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  type_line?: string;
  color_identity?: DeckCard["color_identity"];
  printings?: DeckCard["printings"];
  selected_printing_key?: string | null;
};

function ActionButton({
  label,
  onPress,
  disabled,
  active,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  busy?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.7}
      className={
        "rounded-lg border px-3 py-2 disabled:opacity-50 " +
        (active ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700")
      }
    >
      {busy ? (
        <ActivityIndicator size="small" color="#cbd5e1" />
      ) : (
        <Text className={"text-xs " + (active ? "text-emerald-300" : "text-slate-300")}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export default function DeckView({
  deck: initialDeck,
  deckName,
  suggestedName,
  deckId: initialDeckId,
  inUse: initialInUse,
  poolFilters,
  showOwnership,
  saveSource,
  banner,
  onEdit,
  onSaved,
  onDeckChange,
  onInUseChange,
  onClose,
}: {
  deck: GeneratedDeck;
  /** The saved name; absent for a deck that hasn't been saved yet. */
  deckName?: string;
  /** A name typed before opening an unsaved deck, to start the name field with. */
  suggestedName?: string;
  /** Set for a saved deck; Save then updates it rather than creating another. */
  deckId?: string;
  inUse?: boolean;
  /** Pool scope/sets the deck was built under, so a regenerate stays in bounds. */
  poolFilters?: PoolFilters;
  /** Someone else's deck (Explore): grey out cards you don't own, and no
   *  pin-and-regenerate — it isn't built from your pool. */
  showOwnership?: boolean;
  /** Where the deck came from, recorded when it's first saved. */
  saveSource?: { source: string; source_url?: string };
  /** Shown above the deck — Explore's source and ownership line. */
  banner?: ReactNode;
  /** "Edit cards": hand the deck (and its saved id/name) to the manual builder. */
  onEdit?: (deck: GeneratedDeck, deckId?: string, deckName?: string) => void;
  onSaved?: (saved: SavedDeck) => void;
  /** The deck's contents changed (regenerate), saved or not. */
  onDeckChange?: (deck: GeneratedDeck) => void;
  onInUseChange?: (inUse: boolean) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const maxPrice = user?.preferences?.max_card_price ?? null;

  const untitled = initialDeck.commander
    ? `${initialDeck.commander.name} Deck`
    : `Untitled ${initialDeck.format.charAt(0).toUpperCase()}${initialDeck.format.slice(1)} Deck`;

  const [deck, setDeck] = useState(initialDeck);
  const [deckId, setDeckId] = useState(initialDeckId);
  const [name, setName] = useState(
    deckName ?? (suggestedName?.trim() || (initialDeck.commander ? untitled : "")),
  );
  const [savedAs, setSavedAs] = useState<string | null>(deckName ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inUse, setInUse] = useState(!!initialInUse);
  const [inUseSaving, setInUseSaving] = useState(false);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [regenerating, setRegenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<DetailCard | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [playtesting, setPlaytesting] = useState(false);
  const [pulling, setPulling] = useState(false);
  // Cheapest price per "one card away" missing card, for the budget filter.
  const [nearPrices, setNearPrices] = useState<Map<string, number | null>>(new Map());

  useEffect(() => {
    if (maxPrice == null) return;
    const names = Array.from(new Set(deck.near_combos.map((c) => c.missing_name).filter(Boolean) as string[]));
    if (!names.length) return;
    let cancelled = false;
    Promise.all(
      names.map(async (n) => {
        const d = await fetchCardDetail({ name: n });
        return [n, cheapestPrint(d.prints)?.priceUsd ?? null] as const;
      }),
    ).then((entries) => !cancelled && setNearPrices(new Map(entries)));
    return () => {
      cancelled = true;
    };
  }, [maxPrice, deck.near_combos]);

  const sections = useMemo(
    () =>
      SLOTS.map((s) => ({ ...s, cards: deck.cards.filter((c) => c.slot === s.key) })).filter(
        (s) => s.cards.length > 0,
      ),
    [deck.cards],
  );
  const deckCardIds = useMemo(() => deck.cards.map((c) => c.oracle_id), [deck.cards]);

  // A deck card's sheet reads from the live deck, so re-earmarking a printing
  // re-renders it with the new choice.
  const liveDetail: DetailCard | null = detailId
    ? (deck.cards.find((c) => c.oracle_id === detailId) ?? null)
    : detail;

  const isUnsaved = savedAs === null;
  const nameChanged = !isUnsaved && name.trim() !== savedAs;
  const canSave = !!name.trim() && (isUnsaved || nameChanged || dirty);
  const title = savedAs ?? (name.trim() || untitled);

  const visibleNear =
    maxPrice == null
      ? deck.near_combos
      : deck.near_combos.filter((c) => {
          const price = c.missing_name ? nearPrices.get(c.missing_name) : undefined;
          return price == null || price <= maxPrice;
        });

  /** Leave the sheet, then show the paywall — pushed under a modal it would be hidden. */
  function toPaywall() {
    onClose();
    router.push("/paywall");
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const saved = deckId
        ? await api.updateSavedDeck(deckId, { name: name.trim(), deck })
        : await api.saveDeck(name.trim(), deck, saveSource);
      setDeckId(saved.id);
      setSavedAs(saved.name);
      setDirty(false);
      onSaved?.(saved);
    } catch (e) {
      if (isPremiumRequired(e)) toPaywall();
      else setError(e instanceof Error ? e.message : "Failed to save deck");
    } finally {
      setSaving(false);
    }
  }

  /** Reserve or release this deck's cards. Sent on its own, not folded into Save:
   *  marking a deck assembled is a fact about the shelf, not an edit to the list. */
  async function toggleInUse() {
    if (!deckId) return;
    const next = !inUse;
    setInUse(next);
    setInUseSaving(true);
    setError(null);
    try {
      await api.updateSavedDeck(deckId, { in_use: next });
      onInUseChange?.(next);
    } catch (e) {
      setInUse(!next);
      setError(e instanceof Error ? e.message : "Couldn't update this deck's status");
    } finally {
      setInUseSaving(false);
    }
  }

  async function handleExport() {
    if (!deckId) return;
    const format = await pickExportFormat("Export deck");
    if (!format) return;
    setExporting(true);
    try {
      const csv = await api.exportDeckText(deckId, format);
      await shareCsv(csv, exportFilename(savedAs ?? name, format));
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setExporting(false);
    }
  }

  function toggleLock(oracleId: string) {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(oracleId)) next.delete(oracleId);
      else next.add(oracleId);
      return next;
    });
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const next = await api.generateDeck(deck.commander?.name ?? null, {
        locked: [...locked],
        ...(deck.strategy && deck.strategy !== "Balanced" ? { strategy: deck.strategy } : {}),
        ...(deck.theme ? { theme: deck.theme } : {}),
        // Constructed decks carry their own colors; without them the backend
        // would re-pick colors from scratch. Commander derives them itself.
        ...(deck.format !== "commander" ? { colors: deck.colors, auto_fill_colors: false } : {}),
        format: deck.format,
        ...poolFilters,
        // A deck rebuilding itself must not treat its own copies as taken.
        ...(deckId ? { exclude_deck_id: deckId } : {}),
      });
      setDeck(next);
      setDirty(true);
      onDeckChange?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate deck");
    } finally {
      setRegenerating(false);
    }
  }

  /** Point a deck card at a different owned printing — an unsaved change. */
  function selectPrinting(oracleId: string, printingKey: string) {
    setDeck((prev) => ({
      ...prev,
      cards: prev.cards.map((c): DeckCard =>
        c.oracle_id === oracleId
          ? { ...c, selected_printing_key: printingKey, printing_allocation: { [printingKey]: c.count } }
          : c,
      ),
    }));
    setDirty(true);
  }

  function openCard(ref: CardRef) {
    const inDeck = deck.cards.find((c) => c.oracle_id === ref.oracle_id || c.name === ref.name);
    if (inDeck) {
      setDetailId(inDeck.oracle_id);
    } else {
      setDetailId(null);
      setDetail({ name: ref.name, oracle_id: ref.oracle_id });
    }
  }

  function close() {
    if (!dirty) return onClose();
    Alert.alert("Discard changes?", "This deck has unsaved changes.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  }

  const commander = deck.commander;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between border-b border-slate-800 px-4 pb-3 pt-14">
          <TouchableOpacity onPress={close} hitSlop={8}>
            <Text className="text-sm text-indigo-400">← Back</Text>
          </TouchableOpacity>
          {dirty && <Text className="text-xs text-amber-400">Unsaved changes</Text>}
        </View>

        <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-16 pt-4" keyboardShouldPersistTaps="handled">
          {banner}

          {/* Identity */}
          <View className="flex-row items-start gap-3">
            <View className="flex-1">
              <Text className="text-2xl font-bold text-white">{title}</Text>
              <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
                <Text className="text-sm text-slate-400">
                  {commander ? commander.name : `${deck.format.charAt(0).toUpperCase()}${deck.format.slice(1)}`} ·
                </Text>
                <ColorPips colors={deck.color_identity} size={15} />
              </View>
            </View>
            <View className="items-end rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5">
              <Text className="text-2xl font-bold text-white">{deck.total}</Text>
              <Text className="text-[10px] uppercase tracking-wider text-slate-400">
                {commander ? "+ commander" : "cards"}
              </Text>
            </View>
          </View>

          {/* Commander */}
          {commander && (
            <CommanderCard
              commander={commander}
              onPress={() =>
                setDetail({
                  oracle_id: commander.oracle_id,
                  name: commander.name,
                  mana_cost: commander.mana_cost,
                  type_line: commander.type_line,
                  color_identity: deck.color_identity,
                })
              }
            />
          )}

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
              onPress={handleSave}
              disabled={saving || !canSave}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 disabled:opacity-50"
              activeOpacity={0.7}
            >
              <Text className="text-sm font-medium text-white">
                {saving ? "…" : isUnsaved ? "Save" : nameChanged || dirty ? "Update" : "Saved"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Actions */}
          <View className="flex-row flex-wrap gap-2">
            {onEdit && commander && !showOwnership && (
              <ActionButton
                label="Edit cards"
                // The deck as shown, unsaved changes included — the editor's
                // Update saves the lot.
                onPress={() => onEdit(deck, deckId, savedAs ?? undefined)}
              />
            )}
            <ActionButton label="Playtest" onPress={() => setPlaytesting(true)} />
            <ActionButton label="Pull list" onPress={() => setPulling(true)} />
            {deckId && (
              <>
                <ActionButton
                  label={inUse ? "✓ In use" : "Mark in use"}
                  onPress={toggleInUse}
                  active={inUse}
                  disabled={inUseSaving}
                />
                <ActionButton label="Export" onPress={handleExport} busy={exporting} />
              </>
            )}
          </View>
          {error && <Text className="text-sm text-rose-400">{error}</Text>}

          {deck.bracket && <BracketBadge bracket={deck.bracket} />}

          {/* Stats */}
          <View className="flex-row gap-2">
            <StatTile label="Deck size" value={commander ? `${deck.total}+1` : `${deck.total}`} />
            <StatTile label="Lands" value={deck.land_count} />
          </View>
          <View className="flex-row gap-2">
            <StatTile label="Avg nonland MV" value={deck.stats.avg_nonland_mv ?? "—"} />
            <StatTile label="2+ lands (opener)" value={`${deck.stats.p_2plus_lands_opening ?? "—"}%`} />
          </View>
          <ManaCurve curve={deck.curve} />

          {deck.warnings.length > 0 && (
            <View className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-3">
              {deck.warnings.map((w, i) => (
                <Text key={i} className="text-sm text-amber-300">
                  ⚠ {w}
                </Text>
              ))}
            </View>
          )}

          {/* Pin and regenerate */}
          {!showOwnership && <View className="gap-2 rounded-lg border border-slate-800/60 bg-slate-900/30 px-3 py-2.5">
            <Text className="text-xs leading-4 text-slate-500">
              📌 Press and hold a card to pin it, then regenerate to rebuild the rest around your pins.
              {locked.size > 0 && <Text className="text-amber-400"> {locked.size} pinned</Text>}
            </Text>
            <View className="flex-row items-center justify-end gap-3">
              {locked.size > 0 && (
                <Text onPress={() => setLocked(new Set())} className="text-xs text-slate-500">
                  Clear pins
                </Text>
              )}
              <TouchableOpacity
                onPress={handleRegenerate}
                disabled={regenerating}
                className="rounded-lg border border-emerald-700 px-3 py-1.5 disabled:opacity-50"
                activeOpacity={0.7}
              >
                <Text className="text-sm font-medium text-emerald-300">
                  {regenerating
                    ? "Regenerating…"
                    : locked.size > 0
                      ? `🎲 Regenerate (keep ${locked.size})`
                      : "🎲 Regenerate deck"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>}

          {/* Cards by role */}
          {sections.map((s) => (
            <View key={s.key}>
              <View className="mb-1 flex-row items-center gap-2">
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                <Text className="text-sm font-semibold text-slate-200">
                  {s.label} ({s.cards.reduce((n, c) => n + c.count, 0)})
                </Text>
              </View>
              {s.cards.map((card, i) => {
                const pinned = locked.has(card.oracle_id);
                // In Explore, a card with no owned printing is one you'd need to acquire.
                const unowned = !!showOwnership && !card.printings?.length;
                return (
                  <TouchableOpacity
                    // An imported list can repeat a card (two printings of it on
                    // separate lines), so the id alone isn't a unique key.
                    key={`${card.oracle_id}#${i}`}
                    onPress={() => openCard(card)}
                    onLongPress={showOwnership ? undefined : () => toggleLock(card.oracle_id)}
                    delayLongPress={300}
                    activeOpacity={0.6}
                    className={
                      "flex-row items-center gap-2 border-b border-slate-800/50 py-2 " +
                      (pinned ? "bg-amber-500/10" : "")
                    }
                  >
                    {pinned && <Text className="text-xs">📌</Text>}
                    <Text
                      className={
                        "flex-1 text-sm " + (card.short || unowned ? "italic text-slate-500" : "text-slate-200")
                      }
                      numberOfLines={1}
                    >
                      {card.count > 1 && <Text className="text-slate-500">{card.count}× </Text>}
                      {card.name}
                      {/* Every copy is spoken for by an older in-use deck. */}
                      {card.short && <Text className="text-amber-500"> ⚠</Text>}
                      {card.in_combo && <Text className="text-fuchsia-400"> ⚡</Text>}
                      {card.quality >= 0.3 && <Text className="text-emerald-400"> ◆</Text>}
                    </Text>
                    <ManaCost cost={card.mana_cost} size={12} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          {/* Combos */}
          {deck.combos.length > 0 && (
            <ComboSection
              title={`Combos in this deck (${deck.combos.length})`}
              combos={deck.combos}
              accent="fuchsia"
              onOpenCard={openCard}
            />
          )}
          {visibleNear.length > 0 && (
            <ComboSection title="One card away" combos={visibleNear} accent="amber" near onOpenCard={openCard} />
          )}

          {/* Both come from Commander-only data sources (Spellbook, EDHREC). */}
          {commander && (
            <DeckComboFinishers
              commanderName={commander.name}
              deckCardIds={deckCardIds}
              maxPrice={maxPrice}
              onOpenCard={openCard}
            />
          )}
          {deck.supports_upgrades && commander && (
            <DeckUpgrades
              commanderName={commander.name}
              deckCardIds={deckCardIds}
              maxPrice={maxPrice}
              onOpenCard={openCard}
            />
          )}

          {/* How this was built */}
          <View className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-3">
            <Text className="text-xs leading-4 text-slate-500">
              <Text className="font-medium text-slate-400">How this was built: </Text>
              {deck.strategy ? (
                <>
                  <Text className="text-sky-400">{deck.strategy}</Text> strategy{deck.theme ? ", " : ". "}
                </>
              ) : null}
              {deck.theme ? (
                <>
                  <Text className="text-amber-400">{deck.theme}</Text> theme
                  {deck.theme_count != null && deck.theme_count > 0
                    ? ` (${deck.theme_count} of ${deck.nonland_count} nonlands match)`
                    : deck.theme_count === 0
                      ? " (no cards in your pool matched this theme)"
                      : ""}
                  .{" "}
                </>
              ) : null}
              {deck.edhrec_available ? (
                <>
                  {deck.strategy || deck.theme ? "c" : "C"}ards fill role quotas and the mana curve, ranked by{" "}
                  <Text className="text-emerald-500">EDHREC</Text> — how often the playerbase runs each card with
                  this commander. <Text className="text-emerald-500">◆</Text> = high-synergy pick;{" "}
                  <Text className="text-fuchsia-500">⚡</Text> = part of a combo.
                </>
              ) : (
                <>
                  {deck.strategy || deck.theme ? "c" : "C"}ards fill role quotas and the mana curve, ranked by curve
                  fit and efficiency
                  {commander
                    ? " (no EDHREC data for this commander)"
                    : ` (no community ranking data exists for ${deck.format}, so copies owned and role coverage decide)`}
                  .
                </>
              )}
            </Text>
          </View>
        </ScrollView>

        {liveDetail && (
          <CardDetailModal
            card={liveDetail}
            onSelectPrinting={
              detailId && liveDetail.printings?.length
                ? (key) => selectPrinting(detailId, key)
                : undefined
            }
            onClose={() => {
              setDetailId(null);
              setDetail(null);
            }}
          />
        )}
        {playtesting && <PlaytestModal deck={deck} onClose={() => setPlaytesting(false)} />}
        {pulling && <PullListModal deck={deck} deckName={title} onClose={() => setPulling(false)} />}
      </View>
    </Modal>
  );
}
