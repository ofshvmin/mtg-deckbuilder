import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComboFinisher } from "@mtg/shared";
import { api } from "../lib/api";
import { fetchPrices, type CardPrice } from "../lib/scryfallPrices";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import ManaCost from "./ManaCost";

function fmtPrice(usd: number | null | undefined): string {
  return usd == null ? "—" : `$${usd.toFixed(2)}`;
}

// Cards that would complete a combo with the current deck. Owned finishers can
// be added immediately (onAdd); unowned ones are acquisition suggestions with a
// client-side price. `maxPrice` gates only the unowned list (owned are free to
// add) — the seam for a future profile-level max-price preference.
export default function DeckComboFinishers({
  commanderName,
  deckCardIds,
  onAdd,
  defaultOpen = false,
  maxPrice = null,
}: {
  commanderName: string;
  deckCardIds: string[];
  onAdd?: (oracleId: string) => void;
  defaultOpen?: boolean;
  maxPrice?: number | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishers, setFinishers] = useState<ComboFinisher[]>([]);
  const [prices, setPrices] = useState<Map<string, CardPrice>>(new Map());
  const [showUnowned, setShowUnowned] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [modal, setModal] = useState<CardModalData | null>(null);
  const { hover, onEnter, onLeave } = useCardHover();

  const seq = useRef(0);
  const key = deckCardIds.join(",");

  // (Re)load whenever the panel is open and the deck contents change (debounced).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const recs = await api.getComboFinishers(commanderName, deckCardIds);
        if (mine !== seq.current) return;
        setFinishers(recs);
        setLoadedOnce(true);
        const unowned = recs.filter((r) => !r.owned).map((r) => r.oracle_id);
        fetchPrices(unowned)
          .then((p) => mine === seq.current && setPrices(p))
          .catch(() => {});
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : "Couldn't load combo finishers.");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [open, key, commanderName]);

  function toggleExpand(oid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(oid)) next.delete(oid);
      else next.add(oid);
      return next;
    });
  }

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

  return (
    <div className="rounded-xl border border-fuchsia-900/40 bg-slate-900/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-slate-200">
          ⚡ Combo finishers{" "}
          <span className="font-normal text-slate-500">— cards that complete a combo in this deck</span>
          {ownedCount > 0 && (
            <span className="ml-1 text-emerald-400">{ownedCount} you own</span>
          )}
        </span>
        <span className="text-slate-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-fuchsia-900/30 p-4">
          {loading && <p className="text-sm text-slate-400">Scanning combos…</p>}
          {error && <p className="text-sm text-rose-400">{error}</p>}
          {loadedOnce && !error && finishers.length === 0 && (
            <p className="text-sm text-slate-400">
              No combo finishers found for this deck yet — add more combo pieces and check back.
            </p>
          )}

          {finishers.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-end">
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={showUnowned}
                    onChange={(e) => setShowUnowned(e.target.checked)}
                    className="accent-fuchsia-500"
                  />
                  Show cards I don't own
                </label>
              </div>

              <ul className="divide-y divide-slate-800/60">
                {visible.map((f) => {
                  const usd = prices.get(f.oracle_id)?.usd;
                  const isOpen = expanded.has(f.oracle_id);
                  return (
                    <li key={f.oracle_id} className="py-2">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="cursor-pointer truncate text-sm text-slate-200 hover:text-emerald-300"
                              onClick={() => setModal({ name: f.name, oracle_id: f.oracle_id })}
                              onMouseEnter={(e) => onEnter(e, f.name)}
                              onMouseLeave={onLeave}
                            >
                              {f.name}
                            </span>
                            {f.mana_cost && <ManaCost cost={f.mana_cost} />}
                          </div>
                          <button
                            onClick={() => toggleExpand(f.oracle_id)}
                            className="text-xs text-slate-500 hover:text-slate-300"
                            title="Show the combos this completes"
                          >
                            finishes {f.combo_count} combo{f.combo_count === 1 ? "" : "s"}
                            {f.produces.length > 0 && ` · ${f.produces[0]}`} {isOpen ? "▲" : "▾"}
                          </button>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {f.owned ? (
                            onAdd ? (
                              <button
                                onClick={() => onAdd(f.oracle_id)}
                                className="rounded border border-emerald-700 px-2 py-0.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-900/30"
                              >
                                + Add
                              </button>
                            ) : (
                              <span className="rounded bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-400">Owned</span>
                            )
                          ) : (
                            <span className="text-right text-sm tabular-nums text-slate-400" title="You don't own this — acquisition cost">
                              {fmtPrice(usd)}
                            </span>
                          )}
                        </div>
                      </div>

                      {isOpen && (
                        <ul className="mt-1.5 space-y-1 border-l border-slate-800 pl-3">
                          {f.combos.map((combo) => (
                            <li key={combo.id} className="text-xs text-slate-400">
                              <span className="text-slate-300">{combo.cards.join(" + ")}</span>
                              {combo.produces.length > 0 && (
                                <span className="text-slate-500"> → {combo.produces.join(", ")}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              {visible.length === 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  Only unowned finishers found — enable "Show cards I don't own" to see them.
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
