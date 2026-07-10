import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GeneratedDeck, PoolResponse } from "@mtg/shared";
import { api } from "../lib/api";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import DeckCardList from "./DeckCardList";
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
export default function ManualBuilder({
  pool,
  commanderName,
  onSaved,
}: {
  pool: PoolResponse;
  commanderName: string;
  onSaved?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [deck, setDeck] = useState<GeneratedDeck | null>(null);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState(`${commanderName} Deck`);
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [modal, setModal] = useState<CardModalData | null>(null);
  const { hover, onEnter, onLeave } = useCardHover();

  const selectedSet = useMemo(() => new Set(selected), [selected]);
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

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? pool.pool.filter((c) => c.name.toLowerCase().includes(f)) : pool.pool;
  }, [pool.pool, filter]);
  const shown = filtered.slice(0, POOL_CAP);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const remove = (id: string) => setSelected((prev) => prev.filter((x) => x !== id));

  async function save() {
    if (!deck || !name.trim()) return;
    setSaving(true);
    try {
      await api.saveDeck(name.trim(), deck);
      setSavedAs(name.trim());
      onSaved?.();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  const total = selected.length;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pool picker */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Legal pool · {pool.pool_size.toLocaleString()}
            </div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name…"
              className="w-48 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
            />
          </div>
          <div className="max-h-[40rem] divide-y divide-slate-800/60 overflow-auto">
            {shown.map((c) => {
              const added = selectedSet.has(c.oracle_id);
              return (
                <div key={c.oracle_id} className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
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
                      {added ? "✓ Added" : "+ Add"}
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
              {saving ? "Saving…" : "Save deck"}
            </button>
          </div>
          {savedAs && <p className="text-sm text-emerald-400">Saved as "{savedAs}"</p>}

          {total === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
              Add cards from the pool to start building. Categories and stats appear here as you go.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Cards" value={`${total} / 99`} />
                <StatTile label="Lands" value={deck?.land_count ?? "…"} />
                <StatTile label="Avg MV" value={deck?.stats.avg_nonland_mv ?? "…"} />
                <StatTile
                  label="2+ lands"
                  value={deck ? `${deck.stats.p_2plus_lands_opening}%` : "…"}
                />
              </div>
              {deck && <ManaCurve curve={deck.curve} />}
              {deck && deck.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-amber-300">
                  {deck.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}
              {deck && <DeckCardList cards={deck.cards} onRemove={remove} columnsClassName="columns-1" />}
              {composing && <p className="text-xs text-slate-500">Updating…</p>}
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
