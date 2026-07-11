import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DeckCard, GeneratedDeck, PoolCard, PoolResponse } from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import BracketBadge from "./BracketBadge";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import DeckCardList from "./DeckCardList";
import DeckComboFinishers from "./DeckComboFinishers";
import ManaCost from "./ManaCost";
import ManaCurve from "./ManaCurve";
import StatTile from "./StatTile";

const POOL_CAP = 300;

function shortType(typeLine: string): string {
  return typeLine.split("—")[0].trim();
}

// Hands-on deck builder: add cards from the legal pool and watch a live deck
// take shape — same categories + stats as an auto-built deck, computed by the
// backend /decks/compose endpoint on each (debounced) change.
//
// The "Get suggestions" button generates a full deck using the auto-builder
// and shows those cards as recommendations the user can cherry-pick from.
export default function ManualBuilder({
  pool,
  commanderName,
  strategy,
  theme,
  onSaved,
  initialSelected,
  deckId,
  deckName,
}: {
  pool: PoolResponse;
  commanderName: string;
  strategy?: string;
  theme?: string;
  onSaved?: () => void;
  initialSelected?: string[];         // seed the editor from an existing deck
  deckId?: string;                    // when set, Save updates this saved deck in place
  deckName?: string;
}) {
  const { user } = useAuth();
  const maxPrice = user?.preferences?.max_card_price ?? null;
  const [selected, setSelected] = useState<string[]>(initialSelected ?? []);
  const [deck, setDeck] = useState<GeneratedDeck | null>(null);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState(deckName ?? `${commanderName} Deck`);
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(deckName ?? null);
  const [modal, setModal] = useState<CardModalData | null>(null);
  const { hover, onEnter, onLeave } = useCardHover();

  // Suggestions state
  const [suggestions, setSuggestions] = useState<DeckCard[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const suggestedIds = useMemo(
    () => new Set((suggestions ?? []).map((c) => c.oracle_id)),
    [suggestions],
  );
  // Guards against out-of-order compose responses: only the latest applies.
  const composeSeq = useRef(0);

  // Recompute the deck (categories + stats) whenever the selection changes.
  useEffect(() => {
    if (selected.length === 0) {
      composeSeq.current++; // invalidate any in-flight response
      setDeck(null);
      setComposing(false);
      return;
    }
    setComposing(true);
    const t = setTimeout(() => {
      const seq = ++composeSeq.current;
      api
        .composeDeck(commanderName, selected)
        .then((d) => {
          if (seq === composeSeq.current) setDeck(d);
        })
        .catch(() => {})
        .finally(() => {
          if (seq === composeSeq.current) setComposing(false);
        });
    }, 350);
    return () => clearTimeout(t);
  }, [selected, commanderName]);

  // Fetch suggestions via the auto-generator
  async function fetchSuggestions() {
    setLoadingSuggestions(true);
    try {
      const opts: { strategy?: string; theme?: string } = {};
      if (strategy && strategy !== "Balanced") opts.strategy = strategy;
      if (theme?.trim()) opts.theme = theme.trim();
      const generated = await api.generateDeck(commanderName, opts);
      // Only keep nonland cards as suggestions (lands are auto-handled)
      setSuggestions(generated.cards.filter((c) => c.slot !== "land"));
      setShowSuggestions(true);
    } catch {
      // silent
    } finally {
      setLoadingSuggestions(false);
    }
  }

  // Add all suggested cards at once
  function addAllSuggestions() {
    if (!suggestions) return;
    const ids = suggestions.map((c) => c.oracle_id).filter((id) => !selectedSet.has(id));
    setSelected((prev) => [...prev, ...ids]);
  }

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const base = f ? pool.pool.filter((c) => c.name.toLowerCase().includes(f)) : pool.pool;
    // If showing suggestions, sort suggested cards to the top
    if (showSuggestions && suggestedIds.size > 0) {
      return [...base].sort((a, b) => {
        const aS = suggestedIds.has(a.oracle_id) ? 0 : 1;
        const bS = suggestedIds.has(b.oracle_id) ? 0 : 1;
        return aS - bS;
      });
    }
    return base;
  }, [pool.pool, filter, showSuggestions, suggestedIds]);
  const shown = filtered.slice(0, POOL_CAP);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const remove = (id: string) => setSelected((prev) => prev.filter((x) => x !== id));

  async function save() {
    if (!deck || !name.trim()) return;
    setSaving(true);
    try {
      if (deckId) {
        await api.updateSavedDeck(deckId, { name: name.trim(), deck });
      } else {
        await api.saveDeck(name.trim(), deck);
      }
      setSavedAs(name.trim());
      onSaved?.();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  const total = selected.length;

  // Find suggestion data for a pool card (for showing slot/reason badges)
  function suggestionFor(oracleId: string): DeckCard | undefined {
    return suggestions?.find((s) => s.oracle_id === oracleId);
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pool picker */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Legal pool · {pool.pool_size.toLocaleString()}
              </div>
              <button
                onClick={fetchSuggestions}
                disabled={loadingSuggestions}
                className="rounded-md border border-sky-700 px-2.5 py-1 text-xs font-medium text-sky-400 transition hover:bg-sky-900/30 disabled:opacity-50"
                title="Use the auto-builder to suggest cards for your strategy and theme"
              >
                {loadingSuggestions ? "Thinking..." : showSuggestions ? "Refresh suggestions" : "Get suggestions"}
              </button>
            </div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name..."
              className="w-48 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>

          {/* Suggestion banner */}
          {showSuggestions && suggestions && (
            <div className="flex items-center justify-between border-b border-sky-800/40 bg-sky-950/30 px-4 py-2">
              <span className="text-xs text-sky-300">
                {suggestions.length} cards suggested
                {theme?.trim() ? ` for "${theme.trim()}"` : ""}
                {strategy && strategy !== "Balanced" ? ` (${strategy})` : ""}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={addAllSuggestions}
                  className="rounded px-2 py-0.5 text-xs font-medium text-sky-300 transition hover:bg-sky-900/40"
                >
                  Add all
                </button>
                <button
                  onClick={() => setShowSuggestions(false)}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Hide
                </button>
              </div>
            </div>
          )}

          <div className="max-h-[40rem] divide-y divide-slate-800/60 overflow-auto">
            {shown.map((c) => {
              const added = selectedSet.has(c.oracle_id);
              const sug = showSuggestions ? suggestionFor(c.oracle_id) : undefined;
              return (
                <div
                  key={c.oracle_id}
                  className={
                    "flex items-center justify-between gap-3 px-4 py-1.5 text-sm" +
                    (sug && !added ? " bg-sky-950/20" : "")
                  }
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {sug && !added && (
                      <span className="shrink-0 text-[10px] text-sky-500" title={sug.reason}>
                        *
                      </span>
                    )}
                    <span
                      className="cursor-pointer truncate text-slate-200 hover:text-emerald-300"
                      onClick={() => setModal({
                        oracle_id: c.oracle_id,
                        name: c.name,
                        mana_cost: c.mana_cost,
                        cmc: c.cmc,
                        type_line: c.type_line,
                        color_identity: c.color_identity,
                      })}
                      onMouseEnter={(e) => onEnter(e, c.name)}
                      onMouseLeave={onLeave}
                    >
                      {c.name}
                    </span>
                    <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">
                      {shortType(c.type_line)}
                    </span>
                    {sug && !added && (
                      <span className="hidden shrink-0 rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px] text-sky-400 sm:inline" title={sug.reason}>
                        {sug.slot === "game_plan" ? sug.reason.split(" (")[0] : sug.slot.replace("_", " ")}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ManaCost cost={c.mana_cost} className="text-xs" />
                    <button
                      onClick={() => toggle(c.oracle_id)}
                      className={
                        "rounded px-2 py-0.5 text-xs font-medium transition " +
                        (added
                          ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                          : "border border-slate-700 text-slate-300 hover:bg-slate-800")
                      }
                    >
                      {added ? "Added" : "+ Add"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
            Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
            {filtered.length > POOL_CAP && " — refine the filter to see more"}
          </div>
        </div>

        {/* Working deck */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Deck name"
              className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
            />
            <button
              onClick={save}
              disabled={!deck || saving || !name.trim()}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "Saving..." : deckId ? "Update deck" : "Save deck"}
            </button>
          </div>
          {savedAs && <p className="text-sm text-emerald-400">Saved as "{savedAs}"</p>}

          {total === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
              <p>Add cards from the pool to start building.</p>
              <p className="mt-2">
                Use <strong>Get suggestions</strong> to see what the auto-builder recommends
                {theme?.trim() ? ` for your "${theme.trim()}" theme` : ""}.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Cards" value={`${total} / 99`} />
                <StatTile label="Lands" value={deck?.land_count ?? "..."} />
                <StatTile label="Avg MV" value={deck?.stats.avg_nonland_mv ?? "..."} />
                <StatTile
                  label="2+ lands"
                  value={deck ? `${deck.stats.p_2plus_lands_opening}%` : "..."}
                />
              </div>
              {deck?.bracket && (
                <div>
                  <BracketBadge bracket={deck.bracket} />
                </div>
              )}
              {deck && <ManaCurve curve={deck.curve} />}
              {deck && deck.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-amber-300">
                  {deck.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}
              {deck && <DeckCardList cards={deck.cards} onRemove={remove} columnsClassName="columns-1" />}
              {composing && <p className="text-xs text-slate-500">Updating...</p>}
              <DeckComboFinishers
                commanderName={commanderName}
                deckCardIds={selected}
                defaultOpen
                maxPrice={maxPrice}
                onAdd={(id) => setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]))}
              />
            </>
          )}
        </div>
      </div>

      {hover && createPortal(
        <CardHoverPreview
          name={hover.name}
          printing={hover.printing}
          anchorRect={hover.rect}
        />,
        document.body,
      )}

      {modal && (
        <CardDetailModal card={modal} onClose={() => setModal(null)} />
      )}
    </>
  );
}
