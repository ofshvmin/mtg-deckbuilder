import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import {
  fetchPrices,
  type CardPrice,
  type Combo,
  type ComboFinisher,
  type UpgradeSuggestion,
} from "@mtg/shared";
import { api } from "../lib/api";
import { ManaCost } from "./ManaSymbols";

// The deck view's suggestion panels — combos already in the deck, combo
// finishers, and budget upgrades — matching the web's ComboSection,
// DeckComboFinishers and DeckUpgrades. Card names call `onOpenCard`, so the
// deck view hosts a single card sheet rather than one per panel.

/** A card to open in the detail sheet: a name, and the oracle id when known. */
export type CardRef = { name: string; oracle_id?: string };

function fmtPrice(usd: number | null | undefined): string {
  return usd == null ? "—" : `$${usd.toFixed(2)}`;
}

/** A collapsible bordered panel; the body mounts (and loads) only when opened. */
function Panel({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  onOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View className="rounded-xl border border-slate-800 bg-slate-900/40">
      <TouchableOpacity
        onPress={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        activeOpacity={0.7}
        className="flex-row items-center justify-between px-4 py-3"
      >
        <View className="flex-1 flex-row flex-wrap items-center gap-x-2">
          <Text className="text-sm font-medium text-slate-200">{title}</Text>
          {badge}
          {subtitle && <Text className="text-xs text-slate-500">{subtitle}</Text>}
        </View>
        <Text className="text-slate-500">{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {open && <View className="border-t border-slate-800 p-4">{children}</View>}
    </View>
  );
}

function CardName({ card, onOpenCard, className }: { card: CardRef; onOpenCard: (c: CardRef) => void; className?: string }) {
  return (
    <Text onPress={() => onOpenCard(card)} className={className ?? "text-sm text-slate-200"}>
      {card.name}
    </Text>
  );
}

// ---- combos in the deck / one card away ----

export function ComboSection({
  title,
  combos,
  accent,
  near = false,
  onOpenCard,
}: {
  title: string;
  combos: Combo[];
  accent: "fuchsia" | "amber";
  near?: boolean;
  onOpenCard: (c: CardRef) => void;
}) {
  const border = accent === "fuchsia" ? "border-fuchsia-800/40" : "border-amber-800/40";
  const text = accent === "fuchsia" ? "text-fuchsia-300" : "text-amber-300";
  const shown = combos.slice(0, 10);
  return (
    <View className={`rounded-xl border ${border} bg-slate-900/60`}>
      <Text className={`border-b ${border} px-4 py-2 text-xs font-medium uppercase tracking-wider ${text}`}>
        {title}
      </Text>
      {shown.map((combo) => (
        <View key={combo.id} className="border-b border-slate-800/60 px-4 py-2">
          <Text className="text-sm leading-5 text-slate-200">
            {near && combo.missing_name && <Text className="text-amber-400">+ {combo.missing_name}: </Text>}
            {combo.cards.map((name, i) => (
              <Text key={name}>
                {i > 0 && " + "}
                <CardName card={{ name }} onOpenCard={onOpenCard} />
              </Text>
            ))}
          </Text>
          {combo.produces.length > 0 && (
            <Text className="mt-0.5 text-xs text-slate-500">→ {combo.produces.join(", ")}</Text>
          )}
        </View>
      ))}
      {combos.length > shown.length && (
        <Text className="px-4 py-2 text-xs text-slate-500">+ {combos.length - shown.length} more</Text>
      )}
    </View>
  );
}

// ---- combo finishers ----

/** Cards that would complete a combo with the current deck. `maxPrice` (the
 *  recommendation budget) hides only unowned ones — owned cards cost nothing. */
export function DeckComboFinishers({
  commanderName,
  format = "commander",
  deckCardIds,
  maxPrice,
  onOpenCard,
  onAdd,
  defaultOpen = false,
}: {
  /** Null for 60-card decks, which pass `format` instead. */
  commanderName: string | null;
  format?: string;
  deckCardIds: string[];
  maxPrice: number | null;
  onOpenCard: (c: CardRef) => void;
  /** Manual builder: owned finishers get "+ Add" instead of an "Owned" tag. */
  onAdd?: (oracleId: string) => void;
  defaultOpen?: boolean;
}) {
  const [requested, setRequested] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishers, setFinishers] = useState<ComboFinisher[]>([]);
  const [prices, setPrices] = useState<Map<string, CardPrice>>(new Map());
  const [showUnowned, setShowUnowned] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  const key = deckCardIds.join(",");

  // Reload when opened, and again whenever the deck's contents change (a regenerate).
  useEffect(() => {
    if (!requested) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    api
      .getComboFinishers(commanderName, deckCardIds, format)
      .then((recs) => {
        if (mine !== seq.current) return;
        setFinishers(recs);
        setLoaded(true);
        fetchPrices(recs.filter((r) => !r.owned).map((r) => r.oracle_id))
          .then((p) => mine === seq.current && setPrices(p))
          .catch(() => {});
      })
      .catch((e) => mine === seq.current && setError(e instanceof Error ? e.message : "Couldn't load combo finishers."))
      .finally(() => mine === seq.current && setLoading(false));
  }, [requested, key, commanderName]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = finishers.filter((f) => {
    if (f.owned) return true;
    if (!showUnowned) return false;
    if (maxPrice != null) {
      const usd = prices.get(f.oracle_id)?.usd;
      return usd != null && usd <= maxPrice;
    }
    return true;
  });
  const ownedCount = finishers.filter((f) => f.owned).length;

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Panel
      title="⚡ Combo finishers"
      subtitle="— cards that complete a combo"
      badge={
        ownedCount > 0 ? (
          <Text className="rounded-full bg-emerald-900/50 px-2 text-xs text-emerald-300">{ownedCount} owned</Text>
        ) : undefined
      }
      defaultOpen={defaultOpen}
      onOpen={() => setRequested(true)}
    >
      {loading && !loaded && <ActivityIndicator size="small" color="#64748b" />}
      {error && <Text className="text-sm text-rose-400">{error}</Text>}
      {loaded && !error && finishers.length === 0 && (
        <Text className="text-sm text-slate-400">
          No combo finishers found for this deck yet — add more combo pieces and check back.
        </Text>
      )}
      {finishers.length > 0 && (
        <>
          <TouchableOpacity
            onPress={() => setShowUnowned((v) => !v)}
            activeOpacity={0.7}
            className="mb-2 flex-row items-center gap-2"
          >
            <View
              className={
                "h-4 w-4 items-center justify-center rounded border " +
                (showUnowned ? "border-emerald-500 bg-emerald-600" : "border-slate-600")
              }
            >
              {showUnowned && <Text className="text-[10px] text-white">✓</Text>}
            </View>
            <Text className="text-xs text-slate-400">Show cards I don't own</Text>
          </TouchableOpacity>
          {visible.map((f) => {
            const isOpen = expanded.has(f.oracle_id);
            return (
              <View key={f.oracle_id} className="border-b border-slate-800/60 py-2">
                <View className="flex-row items-center gap-2">
                  <View className="flex-1">
                    <View className="flex-row flex-wrap items-center gap-1.5">
                      <CardName card={f} onOpenCard={onOpenCard} />
                      {f.mana_cost ? <ManaCost cost={f.mana_cost} size={12} /> : null}
                    </View>
                    <Text onPress={() => toggleExpand(f.oracle_id)} className="mt-0.5 text-xs text-slate-500">
                      finishes {f.combo_count} combo{f.combo_count === 1 ? "" : "s"}
                      {f.produces.length > 0 ? ` · ${f.produces[0]}` : ""} {isOpen ? "▲" : "▾"}
                    </Text>
                  </View>
                  {f.owned ? (
                    onAdd ? (
                      <TouchableOpacity
                        onPress={() => onAdd(f.oracle_id)}
                        activeOpacity={0.7}
                        className="rounded border border-emerald-700 px-2 py-0.5"
                      >
                        <Text className="text-xs font-medium text-emerald-300">+ Add</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text className="text-xs text-emerald-400">Owned</Text>
                    )
                  ) : (
                    <Text className="text-sm text-slate-300">{fmtPrice(prices.get(f.oracle_id)?.usd)}</Text>
                  )}
                </View>
                {isOpen &&
                  f.combos.map((combo) => (
                    <Text key={combo.id} className="mt-1.5 pl-3 text-xs leading-4 text-slate-400">
                      {combo.cards.join(" + ")}
                      {combo.produces.length > 0 ? `  → ${combo.produces.join(", ")}` : ""}
                    </Text>
                  ))}
              </View>
            );
          })}
          {visible.length === 0 && (
            <Text className="text-xs text-slate-500">
              Nothing to show{maxPrice != null ? " under your recommendation budget" : ""}.
            </Text>
          )}
        </>
      )}
    </Panel>
  );
}

// ---- budget upgrades ----

type UpgradeSort = "synergy" | "price";

const BUDGETS: { label: string; max: number | null }[] = [
  { label: "Any", max: null },
  { label: "≤ $1", max: 1 },
  { label: "≤ $5", max: 5 },
  { label: "≤ $10", max: 10 },
  { label: "≤ $20", max: 20 },
];

/** Top EDHREC cards for this commander you don't own, with prices. */
export function DeckUpgrades({
  commanderName,
  deckCardIds,
  maxPrice,
  onOpenCard,
}: {
  commanderName: string;
  deckCardIds: string[];
  maxPrice: number | null;
  onOpenCard: (c: CardRef) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<UpgradeSuggestion[]>([]);
  const [prices, setPrices] = useState<Map<string, CardPrice>>(new Map());
  const [budget, setBudget] = useState<number | null>(null);
  const [sort, setSort] = useState<UpgradeSort>("synergy");

  async function load() {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const inDeck = new Set(deckCardIds);
      const recs = (await api.getUpgrades(commanderName)).filter((s) => !inDeck.has(s.oracle_id));
      setSuggestions(recs);
      setLoaded(true);
      // Prices are best-effort: the list renders even if Scryfall is slow.
      fetchPrices(recs.map((r) => r.oracle_id)).then(setPrices).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load upgrade suggestions.");
    } finally {
      setLoading(false);
    }
  }

  const visible = suggestions
    .filter((s) => {
      const usd = prices.get(s.oracle_id)?.usd;
      if (maxPrice != null && (usd == null || usd > maxPrice)) return false;
      if (budget == null) return true;
      return usd != null && usd <= budget;
    })
    .sort((a, b) => {
      if (sort === "price") {
        const pa = prices.get(a.oracle_id)?.usd ?? Infinity;
        const pb = prices.get(b.oracle_id)?.usd ?? Infinity;
        if (pa !== pb) return pa - pb;
      }
      return b.score - a.score;
    });
  const shownTotal = visible.reduce((sum, s) => sum + (prices.get(s.oracle_id)?.usd ?? 0), 0);

  return (
    <Panel title="💎 Budget upgrades" subtitle="— top cards you don't own" onOpen={load}>
      {loading && <Text className="text-sm text-slate-400">Finding upgrades from EDHREC…</Text>}
      {error && <Text className="text-sm text-rose-400">{error}</Text>}
      {loaded && !error && suggestions.length === 0 && (
        <Text className="text-sm text-slate-400">
          No upgrade suggestions available for this commander (EDHREC data may be missing).
        </Text>
      )}
      {loaded && suggestions.length > 0 && (
        <>
          <View className="mb-2 flex-row flex-wrap gap-1.5">
            {BUDGETS.map((b) => (
              <TouchableOpacity
                key={b.label}
                onPress={() => setBudget(b.max)}
                activeOpacity={0.7}
                className={"rounded-md px-2.5 py-1 " + (budget === b.max ? "bg-slate-800" : "")}
              >
                <Text className={"text-xs " + (budget === b.max ? "text-slate-100" : "text-slate-400")}>
                  {b.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View className="mb-2 flex-row items-center gap-2">
            <Text className="text-xs text-slate-500">Sort</Text>
            {(["synergy", "price"] as const).map((k) => (
              <Text
                key={k}
                onPress={() => setSort(k)}
                className={"text-xs " + (sort === k ? "text-emerald-400" : "text-slate-400")}
              >
                {k === "synergy" ? "Synergy" : "Price"}
              </Text>
            ))}
          </View>
          {visible.map((s) => (
            <View key={s.oracle_id} className="flex-row items-center gap-3 border-b border-slate-800/60 py-2">
              <View className="flex-1">
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <CardName card={s} onOpenCard={onOpenCard} />
                  {s.mana_cost ? <ManaCost cost={s.mana_cost} size={12} /> : null}
                  {s.synergy >= 0.3 && <Text className="text-emerald-500">◆</Text>}
                </View>
                <Text className="text-xs text-slate-500">{s.reason}</Text>
              </View>
              <Text className="text-sm text-slate-300">{fmtPrice(prices.get(s.oracle_id)?.usd)}</Text>
            </View>
          ))}
          <Text className="mt-3 text-xs text-slate-500">
            {visible.length === 0
              ? "No suggestions under that budget — try a higher one."
              : `${visible.length} card${visible.length === 1 ? "" : "s"} · ${
                  shownTotal > 0 ? `~$${shownTotal.toFixed(2)} total` : "prices loading…"
                }`}
          </Text>
        </>
      )}
    </Panel>
  );
}
