import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DeckCard, Printing } from "@mtg/shared";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import CardImage from "./CardImage";
import ManaCost from "./ManaCost";
import PrintingChips from "./PrintingChips";

// Deck cards grouped into role categories. Three views (Moxfield-style):
//   text   — height-balanced masonry of text rows (default)
//   stacks — overlapping card images per column, titles visible
//   grid   — full card images in a grid
// Shared by the read-only DeckView and the interactive manual builder.

const SLOTS: { key: string; label: string; dot: string }[] = [
  { key: "land", label: "Lands", dot: "bg-amber-500" },
  { key: "ramp", label: "Ramp", dot: "bg-emerald-500" },
  { key: "card_draw", label: "Card Draw", dot: "bg-sky-500" },
  { key: "removal", label: "Removal", dot: "bg-rose-500" },
  { key: "board_wipe", label: "Board Wipes", dot: "bg-red-600" },
  { key: "game_plan", label: "Game Plan", dot: "bg-fuchsia-500" },
];

type View = "text" | "stacks" | "grid";
const VIEW_KEY = "mtg.deckView";

// Fixed card geometry for the stacks view (magic ratio 1040/745 ≈ 1.396).
const STACK_W = 190;
const STACK_H = Math.round(STACK_W * 1.396);
const STACK_TITLE = 34; // px of the card's title bar left visible when overlapped

function displayPrinting(c: DeckCard): Printing | undefined {
  return (
    c.printings?.find((p) => p.printing_key === c.selected_printing_key) ??
    c.printings?.[0]
  );
}

function deckCardToModal(c: DeckCard): CardModalData {
  return {
    oracle_id: c.oracle_id,
    name: c.name,
    mana_cost: c.mana_cost,
    cmc: c.cmc,
    type_line: c.type_line,
    color_identity: c.color_identity,
    printings: c.printings,
  };
}

export default function DeckCardList({
  cards,
  onRemove,
  locked,
  onToggleLock,
  columnsClassName = "columns-1 sm:columns-2",
}: {
  cards: DeckCard[];
  onRemove?: (oracleId: string) => void;
  locked?: Set<string>;
  onToggleLock?: (oracleId: string) => void;
  columnsClassName?: string;
}) {
  const [modal, setModal] = useState<CardModalData | null>(null);
  const { hover, onEnter, onLeave } = useCardHover();
  const [view, setView] = useState<View>(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(VIEW_KEY) : null;
    return v === "stacks" || v === "grid" ? v : "text";
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const groups = SLOTS.map((s) => ({ ...s, cards: cards.filter((c) => c.slot === s.key) })).filter(
    (g) => g.cards.length > 0,
  );

  const groupHeader = (label: string, dot: string, count: number) => (
    <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-300">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
      <span className="text-slate-500">{count}</span>
    </div>
  );

  return (
    <>
      {/* View toggle */}
      <div className="mb-3 flex justify-end">
        <div className="inline-flex rounded-lg border border-slate-700 p-0.5 text-xs">
          {(["text", "stacks", "grid"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                "rounded-md px-2.5 py-1 capitalize transition " +
                (view === v ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200")
              }
            >
              {v === "text" ? "☰ Text" : v === "stacks" ? "▦ Stacks" : "▤ Grid"}
            </button>
          ))}
        </div>
      </div>

      {view === "text" && (
        <div className={`gap-4 [column-fill:balance] ${columnsClassName}`}>
          {groups.map(({ key, label, dot, cards: slotCards }) => (
            <div key={key} className="mb-4 break-inside-avoid rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 sm:px-4">
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-300">
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  {label}
                </span>
                <span className="text-xs tabular-nums text-slate-500">
                  {slotCards.reduce((s, c) => s + c.count, 0)}
                </span>
              </div>
              <ul className="divide-y divide-slate-800/60">
                {slotCards.map((c) => (
                  <DeckRow
                    key={c.oracle_id}
                    card={c}
                    onRemove={onRemove}
                    locked={locked?.has(c.oracle_id)}
                    onToggleLock={onToggleLock}
                    onClick={() => setModal(deckCardToModal(c))}
                    onHoverEnter={onEnter}
                    onHoverLeave={onLeave}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {view === "grid" && (
        <div className="space-y-6">
          {groups.map(({ key, label, dot, cards: slotCards }) => (
            <div key={key}>
              {groupHeader(label, dot, slotCards.reduce((s, c) => s + c.count, 0))}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {slotCards.map((c) => (
                  <ImageCell
                    key={c.oracle_id}
                    card={c}
                    onClick={() => setModal(deckCardToModal(c))}
                    onRemove={onRemove}
                    locked={locked?.has(c.oracle_id)}
                    onToggleLock={onToggleLock}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "stacks" && (
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          {groups.map(({ key, label, dot, cards: slotCards }) => (
            <div key={key}>
              {groupHeader(label, dot, slotCards.reduce((s, c) => s + c.count, 0))}
              <div className="flex flex-col" style={{ width: STACK_W }}>
                {slotCards.map((c, i) => (
                  <div
                    key={c.oracle_id}
                    className="relative transition-transform hover:z-40"
                    style={{ marginTop: i === 0 ? 0 : -(STACK_H - STACK_TITLE), zIndex: i }}
                  >
                    <ImageCell
                      card={c}
                      onClick={() => setModal(deckCardToModal(c))}
                      onRemove={onRemove}
                      locked={locked?.has(c.oracle_id)}
                      onToggleLock={onToggleLock}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {hover && createPortal(
        <CardHoverPreview name={hover.name} printing={hover.printing} anchorRect={hover.rect} />,
        document.body,
      )}
      {modal && <CardDetailModal card={modal} onClose={() => setModal(null)} />}
    </>
  );
}

// A card image with count badge + combo/synergy markers, and (when provided)
// remove / lock controls that appear on hover. Used by grid and stacks views.
function ImageCell({
  card,
  onClick,
  onRemove,
  locked,
  onToggleLock,
}: {
  card: DeckCard;
  onClick: () => void;
  onRemove?: (oracleId: string) => void;
  locked?: boolean;
  onToggleLock?: (oracleId: string) => void;
}) {
  const printing = displayPrinting(card);
  const highSynergy = card.quality >= 0.3;
  return (
    <div className="group relative">
      <button onClick={onClick} className="block w-full" title={card.name}>
        <CardImage
          printing={printing}
          name={card.name}
          typeLine={card.type_line}
          manaCost={card.mana_cost}
          isFoil={printing?.finish === "foil"}
          className="aspect-[745/1040] w-full shadow-md ring-1 ring-black/40 transition group-hover:ring-emerald-500/60"
        />
      </button>

      {/* Corner markers */}
      <div className="pointer-events-none absolute left-1 top-1 flex gap-1">
        {card.count > 1 && (
          <span className="rounded bg-black/80 px-1.5 text-xs font-medium text-white">{card.count}×</span>
        )}
        {card.in_combo && <span className="rounded bg-black/70 px-1 text-xs text-fuchsia-300">⚡</span>}
        {highSynergy && <span className="rounded bg-black/70 px-1 text-xs text-emerald-300">◆</span>}
      </div>

      {/* Hover controls */}
      {(onToggleLock || onRemove) && (
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
          {onToggleLock && (
            <button
              onClick={() => onToggleLock(card.oracle_id)}
              className={"rounded bg-black/80 px-1 text-xs " + (locked ? "text-amber-400" : "text-slate-300 hover:text-amber-400")}
              title={locked ? "Locked — kept when regenerating" : "Lock this card"}
            >
              {locked ? "📌" : "📍"}
            </button>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(card.oracle_id)}
              className="rounded bg-black/80 px-1 text-xs text-slate-300 hover:text-rose-400"
              title="Remove from deck"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DeckRow({
  card,
  onRemove,
  locked,
  onToggleLock,
  onClick,
  onHoverEnter,
  onHoverLeave,
}: {
  card: DeckCard;
  onRemove?: (oracleId: string) => void;
  locked?: boolean;
  onToggleLock?: (oracleId: string) => void;
  onClick: () => void;
  onHoverEnter: (e: React.MouseEvent, name: string, printing?: Printing) => void;
  onHoverLeave: () => void;
}) {
  const highSynergy = card.quality >= 0.3;
  const firstPrinting = card.printings?.[0];
  return (
    <li className="group flex items-center gap-2 px-3 py-1.5 text-sm sm:px-4">
      <span
        className="min-w-0 flex-1 cursor-pointer truncate text-slate-200 hover:text-emerald-300"
        onClick={onClick}
        onMouseEnter={(e) => onHoverEnter(e, card.name, firstPrinting)}
        onMouseLeave={onHoverLeave}
      >
        {card.count > 1 && <span className="mr-1 text-slate-500">{card.count}×</span>}
        {card.name}
        {card.in_combo && <span className="ml-1 text-fuchsia-400">⚡</span>}
        {highSynergy && <span className="ml-1 text-emerald-400">◆</span>}
      </span>
      <span className="hidden sm:inline-flex"><PrintingChips printings={card.printings} /></span>
      <span className="hidden shrink-0 sm:inline-flex"><ManaCost cost={card.mana_cost} className="text-xs" /></span>
      {onToggleLock && (
        <button
          onClick={() => onToggleLock(card.oracle_id)}
          className={"shrink-0 text-xs leading-none transition " + (locked ? "text-amber-400" : "text-slate-600 hover:text-amber-400")}
          title={locked ? "Locked" : "Lock"}
        >
          {locked ? "📌" : "📍"}
        </button>
      )}
      {onRemove && (
        <button onClick={() => onRemove(card.oracle_id)}
          className="shrink-0 text-xs leading-none text-slate-600 transition hover:text-rose-400" title="Remove">✕</button>
      )}
    </li>
  );
}
