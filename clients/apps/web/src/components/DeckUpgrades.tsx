import { useState } from "react";
import { createPortal } from "react-dom";
import type { UpgradeSuggestion } from "@mtg/shared";
import { api } from "../lib/api";
import { fetchPrices, type CardPrice } from "../lib/scryfallPrices";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import ManaCost from "./ManaCost";

type SortKey = "synergy" | "price";
const BUDGETS: { label: string; max: number | null }[] = [
  { label: "Any price", max: null },
  { label: "≤ $1", max: 1 },
  { label: "≤ $5", max: 5 },
  { label: "≤ $10", max: 10 },
  { label: "≤ $20", max: 20 },
];

function fmtPrice(usd: number | null | undefined): string {
  return usd == null ? "—" : `$${usd.toFixed(2)}`;
}

export default function DeckUpgrades({
  commanderName,
  deckCardIds = [],
}: {
  commanderName: string;
  deckCardIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState<UpgradeSuggestion[]>([]);
  const [prices, setPrices] = useState<Map<string, CardPrice>>(new Map());
  const [budget, setBudget] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("synergy");

  const [modal, setModal] = useState<CardModalData | null>(null);
  const { hover, onEnter, onLeave } = useCardHover();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const inDeck = new Set(deckCardIds);
      const recs = (await api.getUpgrades(commanderName)).filter(
        (s) => !inDeck.has(s.oracle_id),
      );
      setSuggestions(recs);
      setLoaded(true);
      // Prices are best-effort; render the list even if Scryfall is slow/down.
      fetchPrices(recs.map((r) => r.oracle_id))
        .then(setPrices)
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load upgrade suggestions.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) load();
  }

  const visible = suggestions
    .filter((s) => {
      if (budget == null) return true;
      const usd = prices.get(s.oracle_id)?.usd;
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
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-slate-200">
          💎 Budget upgrades{" "}
          <span className="font-normal text-slate-500">— top cards you don't own</span>
        </span>
        <span className="text-slate-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800 p-4">
          {loading && <p className="text-sm text-slate-400">Finding upgrades from EDHREC…</p>}
          {error && <p className="text-sm text-rose-400">{error}</p>}

          {loaded && !error && suggestions.length === 0 && (
            <p className="text-sm text-slate-400">
              No upgrade suggestions available for this commander (EDHREC data may be missing).
            </p>
          )}

          {loaded && suggestions.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-700 p-0.5">
                  {BUDGETS.map((b) => (
                    <button
                      key={b.label}
                      onClick={() => setBudget(b.max)}
                      className={
                        "rounded-md px-2.5 py-1 text-xs transition " +
                        (budget === b.max
                          ? "bg-slate-800 text-slate-100"
                          : "text-slate-400 hover:text-slate-200")
                      }
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
                  <span>Sort</span>
                  <button
                    onClick={() => setSort("synergy")}
                    className={sort === "synergy" ? "text-emerald-400" : "hover:text-slate-200"}
                  >
                    Synergy
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    onClick={() => setSort("price")}
                    className={sort === "price" ? "text-emerald-400" : "hover:text-slate-200"}
                  >
                    Price
                  </button>
                </div>
              </div>

              <ul className="divide-y divide-slate-800/60">
                {visible.map((s) => {
                  const usd = prices.get(s.oracle_id)?.usd;
                  return (
                    <li key={s.oracle_id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="cursor-pointer truncate text-sm text-slate-200 hover:text-emerald-300"
                            onClick={() => setModal({ name: s.name, oracle_id: s.oracle_id })}
                            onMouseEnter={(e) => onEnter(e, s.name)}
                            onMouseLeave={onLeave}
                          >
                            {s.name}
                          </span>
                          {s.mana_cost && <ManaCost cost={s.mana_cost} />}
                          {s.synergy >= 0.3 && (
                            <span className="text-emerald-500" title="High synergy">◆</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">{s.reason}</div>
                      </div>
                      <div className="shrink-0 text-right text-sm tabular-nums text-slate-300">
                        {fmtPrice(usd)}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {visible.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  No suggestions under that budget — try a higher one.
                </p>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  {visible.length} card{visible.length === 1 ? "" : "s"} ·{" "}
                  {shownTotal > 0 ? `~$${shownTotal.toFixed(2)} total` : "prices loading…"}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {hover && createPortal(
        <CardHoverPreview name={hover.name} printing={hover.printing} anchorRect={hover.rect} />,
        document.body,
      )}
      {modal && <CardDetailModal card={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
