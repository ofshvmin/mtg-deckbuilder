import { useEffect, useRef, useState } from "react";
import type { CollectionCard, Printing } from "@mtg/shared";
import { api } from "../lib/api";
import { formatManaCost } from "../lib/format";
import CardImage from "./CardImage";
import ColorPips from "./ColorPips";

// Modal focused on one owned printing of a card at a time, with left/right
// navigation (buttons, arrow keys, touch swipe) across every printing owned,
// plus a detail panel exposing the persisted inventory data for that copy.
export default function CardDetailModal({
  card,
  onClose,
  onRemoved,
}: {
  card: CollectionCard;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const printings = card.printings.length ? card.printings : [];
  const [index, setIndex] = useState(0);
  const [removing, setRemoving] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const count = printings.length;
  const current: Printing | undefined = printings[index];

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
              <span>{card.type_line}</span>
              {card.mana_cost && (
                <span className="font-mono text-xs text-slate-300">
                  {formatManaCost(card.mana_cost)}
                </span>
              )}
              <ColorPips colors={card.color_identity} />
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

        <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,300px)_1fr]">
          {/* Image + printing navigation */}
          <div className="space-y-3">
            <div
              className="relative"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              <CardImage printing={current} name={card.name} className="aspect-[5/7] w-full" />
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

            {count > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
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
            )}
            <p className="text-center text-xs text-slate-500">
              {count > 1 ? `Printing ${index + 1} of ${count}` : "1 printing owned"}
            </p>
          </div>

          {/* Detail panel for the focused printing */}
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">
                This copy
              </h3>
              <dl className="mt-2 divide-y divide-slate-800/60 rounded-xl border border-slate-800 bg-slate-900/40 text-sm">
                <DetailRow label="Set" value={current?.edition?.toUpperCase()} />
                <DetailRow label="Collector #" value={current?.collector_number} />
                <DetailRow
                  label="Finish"
                  value={current?.finish === "foil" ? "Foil" : "Nonfoil"}
                />
                <DetailRow label="Condition" value={current?.condition} />
                <DetailRow label="Language" value={current?.language?.toUpperCase()} />
                <DetailRow label="Copies" value={current ? `${current.count}` : undefined} />
                <DetailRow
                  label="Purchase price"
                  value={
                    current?.purchase_price != null
                      ? `$${current.purchase_price.toFixed(2)}`
                      : undefined
                  }
                />
                <DetailRow label="Date added" value={formatDate(current?.added_at)} />
              </dl>
              <p className="mt-2 text-xs text-slate-500">
                Total owned across all printings: {card.total_count}
              </p>
            </div>

            {card.oracle_text && (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Oracle text
                </h3>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {card.oracle_text}
                </p>
              </div>
            )}

            <button
              onClick={handleRemove}
              disabled={removing}
              className="rounded-lg border border-rose-900/60 px-3 py-1.5 text-sm text-rose-400 transition hover:bg-rose-950/40 disabled:opacity-50"
              title="Remove this card (all printings) from your collection"
            >
              {removing ? "Removing…" : "Remove from collection"}
            </button>
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

function formatDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
