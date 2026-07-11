import { useState } from "react";
import { createPortal } from "react-dom";
import type { DeckCard } from "@mtg/shared";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import ManaCost from "./ManaCost";
import PrintingChips from "./PrintingChips";

// Deck cards grouped into role categories, laid out as a height-balanced
// masonry so short sections don't leave gaps. Shared by the read-only DeckView
// and the interactive manual builder (which passes onRemove to add a x per row).
// Every card name shows a hover image preview and opens a detail modal on click.

const SLOTS: { key: string; label: string; dot: string }[] = [
  { key: "land", label: "Lands", dot: "bg-amber-500" },
  { key: "ramp", label: "Ramp", dot: "bg-emerald-500" },
  { key: "card_draw", label: "Card Draw", dot: "bg-sky-500" },
  { key: "removal", label: "Removal", dot: "bg-rose-500" },
  { key: "board_wipe", label: "Board Wipes", dot: "bg-red-600" },
  { key: "game_plan", label: "Game Plan", dot: "bg-fuchsia-500" },
];

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

  const bySlot = (slot: string) => cards.filter((c) => c.slot === slot);
  return (
    <>
      <div className={`gap-4 [column-fill:balance] ${columnsClassName}`}>
        {SLOTS.map(({ key, label, dot }) => {
          const slotCards = bySlot(key);
          if (slotCards.length === 0) return null;
          const total = slotCards.reduce((s, c) => s + c.count, 0);
          return (
            <div key={key} className="mb-4 break-inside-avoid rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-300">
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  {label}
                </span>
                <span className="text-xs tabular-nums text-slate-500">{total}</span>
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
          );
        })}
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
  onHoverEnter: (e: React.MouseEvent, name: string, printing?: import("@mtg/shared").Printing) => void;
  onHoverLeave: () => void;
}) {
  const highSynergy = card.quality >= 0.3;
  const firstPrinting = card.printings?.[0];
  return (
    <li className="group flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
      <span
        className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-1 text-slate-200 hover:text-emerald-300"
        onClick={onClick}
        onMouseEnter={(e) => onHoverEnter(e, card.name, firstPrinting)}
        onMouseLeave={onHoverLeave}
      >
        <span className="truncate">
          {card.count > 1 && <span className="mr-1 text-slate-500">{card.count}×</span>}
          {card.name}
        </span>
        {card.in_combo && (
          <span className="text-fuchsia-400" title="Part of a combo in this deck">
            ⚡
          </span>
        )}
        {highSynergy && (
          <span
            className="text-emerald-400"
            title={`High synergy with this commander (EDHREC score ${card.quality.toFixed(2)})`}
          >
            ◆
          </span>
        )}
        <PrintingChips printings={card.printings} />
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <ManaCost cost={card.mana_cost} className="text-xs" />
        {onToggleLock && (
          <button
            onClick={() => onToggleLock(card.oracle_id)}
            className={
              "text-xs transition " +
              (locked ? "text-amber-400" : "text-slate-600 hover:text-amber-400")
            }
            title={locked ? "Locked — kept when regenerating" : "Lock this card"}
          >
            {locked ? "📌" : "📍"}
          </button>
        )}
        {onRemove && (
          <button
            onClick={() => onRemove(card.oracle_id)}
            className="text-xs text-slate-600 transition hover:text-rose-400"
            title="Remove from deck"
          >
            ✕
          </button>
        )}
      </span>
    </li>
  );
}
