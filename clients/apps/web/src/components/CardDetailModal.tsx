import { useEffect, useRef, useState } from "react";
import type { CollectionCard, Printing, Color } from "@mtg/shared";
import { api } from "../lib/api";
import { cheapestPrint, fetchCardDetail, type CardDetail } from "../lib/scryfallPrints";
import { lookupSet, useScryfallSets } from "../lib/scryfallSets";
import CardImage from "./CardImage";
import ColorPips from "./ColorPips";
import ManaCost from "./ManaCost";
import SetSymbol from "./SetSymbol";

// Flexible card data — CollectionCard has all fields; DeckCard / PoolCard have
// a subset. The modal degrades gracefully for missing fields.
export interface CardModalData {
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  color_identity?: Color[];
  oracle_text?: string;
  total_count?: number;
  printings?: Printing[];
}

// Adapter: convert a CollectionCard to CardModalData (they're already compatible).
export function fromCollectionCard(c: CollectionCard): CardModalData {
  return c;
}

// Modal focused on one owned printing of a card at a time, with left/right
// navigation (buttons, arrow keys, touch swipe) across every printing owned,
// plus a detail panel exposing the persisted inventory data for that copy.
export default function CardDetailModal({
  card: initialCard,
  onClose,
  onRemoved,
}: {
  card: CardModalData;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const [card, setCard] = useState<CardModalData>(initialCard);
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [index, setIndex] = useState(0);
  const [removing, setRemoving] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Always fetch Scryfall market data (prices + oracle text + every printing) so
  // every card detail view is uniform — market price shows whether owned or not.
  useEffect(() => {
    let cancelled = false;
    fetchCardDetail({ oracleId: card.oracle_id, name: card.name }).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => { cancelled = true; };
  }, [card.oracle_id, card.name]);

  // If opened with incomplete data (no oracle_text or no printings), fetch the
  // full card from the collection API so every modal looks the same.
  useEffect(() => {
    if (card.oracle_text && card.printings?.length) return;
    let cancelled = false;
    api.listCollectionCards().then((cards) => {
      if (cancelled) return;
      const match = cards.find(
        (c) => c.oracle_id === card.oracle_id || c.name === card.name,
      );
      if (match) {
        setCard((prev) => ({
          ...prev,
          oracle_text: prev.oracle_text || match.oracle_text,
          printings: prev.printings?.length ? prev.printings : match.printings,
          total_count: prev.total_count ?? match.total_count,
          type_line: prev.type_line || match.type_line,
          mana_cost: prev.mana_cost || match.mana_cost,
          color_identity: prev.color_identity?.length ? prev.color_identity : match.color_identity,
        }));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const owned = card.printings?.length ? card.printings : [];
  const isOwned = owned.length > 0;
  const cheapest = detail ? cheapestPrint(detail.prints) : undefined;

  // Owned cards show their owned printings; unowned cards show the cheapest printing.
  const printings: Printing[] = isOwned
    ? owned
    : cheapest
      ? [{
          printing_key: `market:${cheapest.set}:${cheapest.collectorNumber}`,
          edition: cheapest.set,
          collector_number: cheapest.collectorNumber,
          finish: "nonfoil",
          condition: null,
          language: null,
          count: 0,
        }]
      : [];

  const count = printings.length;
  const current: Printing | undefined = printings[index];

  // Market (Scryfall) price for the focused printing — matched by set + collector.
  const marketUsd: number | null = (() => {
    if (!detail || !current) return null;
    const hit = detail.prints.find(
      (p) => p.set.toLowerCase() === (current.edition ?? "").toLowerCase() &&
             p.collectorNumber === current.collector_number,
    );
    const usd = hit ? (current.finish === "foil" ? hit.priceUsdFoil ?? hit.priceUsd : hit.priceUsd) : null;
    return usd ?? cheapest?.priceUsd ?? null;
  })();

  const oracleText = card.oracle_text || detail?.oracleText;
  const typeLine = card.type_line || detail?.typeLine;
  const manaCost = card.mana_cost || detail?.manaCost;

  const sets = useScryfallSets();
  const setInfo = lookupSet(sets, current?.edition);
  const setName = setInfo?.name ?? (current?.edition ? current.edition.toUpperCase() : "Unknown set");

  const go = (delta: number) => {
    if (count <= 1) return;
    setIndex((i) => (i + delta + count) % count);
  };

  // Keyboard: Esc closes, arrows cycle printings.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  }

  async function handleRemove() {
    if (!card.oracle_id) return;
    setRemoving(true);
    try {
      await api.removeCard(card.oracle_id);
      onRemoved?.();
      onClose();
    } catch {
      setRemoving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-5">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-slate-100">{card.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
              {typeLine && <span>{typeLine}</span>}
              {manaCost && <ManaCost cost={manaCost} className="text-sm" />}
              {card.color_identity && <ColorPips colors={card.color_identity} />}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Set banner — the primary identity of this copy. Updates per printing. */}
        {count > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/40 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <SetSymbol iconUri={setInfo?.iconSvgUri} code={current?.edition} className="h-11 w-11" />
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-slate-100">{setName}</div>
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  {current?.edition?.toUpperCase() || "—"}
                  {current?.collector_number && (
                    <span className="ml-1.5">#{current.collector_number}</span>
                  )}
                  {current?.finish === "foil" && <span className="ml-1.5 text-amber-500">Foil</span>}
                </div>
              </div>
            </div>
            {count > 1 && (
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {printings.map((p, i) => (
                    <button
                      key={p.printing_key}
                      onClick={() => setIndex(i)}
                      className={
                        "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase transition " +
                        (i === index
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300")
                      }
                      title={`${p.edition || "—"}${p.finish === "foil" ? " · foil" : ""}`}
                    >
                      {p.edition || "—"}
                      {p.finish === "foil" && <span className="ml-0.5 text-amber-500">✦</span>}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-500">
                  Printing {index + 1} of {count}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,300px)_1fr]">
          {/* Image + printing navigation */}
          <div className="space-y-3">
            <div
              className="relative"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              <CardImage
                key={current?.printing_key ?? "no-printing"}
                printing={current}
                name={card.name}
                typeLine={card.type_line}
                manaCost={card.mana_cost}
                className="aspect-[5/7] w-full"
              />
              {count > 1 && (
                <>
                  <button
                    onClick={() => go(-1)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2 py-3 text-lg text-white transition hover:bg-black/80"
                    title="Previous printing (←)"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => go(1)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2 py-3 text-lg text-white transition hover:bg-black/80"
                    title="Next printing (→)"
                  >
                    ›
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Detail panel — uniform across owned and unowned cards */}
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {isOwned ? "Your copy" : "Details"}
              </h3>
              <dl className="mt-2 divide-y divide-slate-800/60 rounded-xl border border-slate-800 bg-slate-900/40 text-sm">
                {/* Market price — the headline field, shown on every card */}
                <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <dt className="text-slate-400">Market price{current?.finish === "foil" ? " (foil)" : ""}</dt>
                  <dd className="text-right text-base font-semibold tabular-nums text-emerald-300">
                    {marketUsd != null ? `$${marketUsd.toFixed(2)}` : detail ? "—" : "…"}
                  </dd>
                </div>
                {isOwned && <DetailRow label="Owned" value={current ? `${current.count}` : undefined} />}
                {isOwned && (
                  <DetailRow
                    label="You paid"
                    value={current?.purchase_price != null ? `$${current.purchase_price.toFixed(2)}` : undefined}
                  />
                )}
                <DetailRow label="Finish" value={current?.finish === "foil" ? "Foil" : "Nonfoil"} />
                {isOwned && <DetailRow label="Condition" value={current?.condition} />}
              </dl>
              {isOwned && card.total_count != null ? (
                <p className="mt-2 text-xs text-slate-500">
                  Total owned across all printings: {card.total_count}
                </p>
              ) : !isOwned ? (
                <p className="mt-2 text-xs text-slate-500">
                  Not in your collection — showing the cheapest printing.
                </p>
              ) : null}
            </div>

            {oracleText && (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Oracle text
                </h3>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {oracleText}
                </p>
              </div>
            )}

            {onRemoved && card.oracle_id && (
              <button
                onClick={handleRemove}
                disabled={removing}
                className="rounded-lg border border-rose-900/60 px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-950/40 disabled:opacity-50"
                title="Remove this card (all printings) from your collection"
              >
                {removing ? "Removing…" : "Remove from collection"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  );
}
