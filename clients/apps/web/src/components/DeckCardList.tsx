import type { DeckCard } from "@mtg/shared";
import ManaCost from "./ManaCost";
import PrintingChips from "./PrintingChips";

// Deck cards grouped into role categories, laid out as a height-balanced
// masonry so short sections don't leave gaps. Shared by the read-only DeckView
// and the interactive manual builder (which passes onRemove to add a ✕ per row).

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
  columnsClassName = "columns-1 sm:columns-2",
}: {
  cards: DeckCard[];
  onRemove?: (oracleId: string) => void;
  columnsClassName?: string;
}) {
  const bySlot = (slot: string) => cards.filter((c) => c.slot === slot);
  return (
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
                <DeckRow key={c.oracle_id} card={c} onRemove={onRemove} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function DeckRow({ card, onRemove }: { card: DeckCard; onRemove?: (oracleId: string) => void }) {
  const highSynergy = card.quality >= 0.3;
  return (
    <li className="group flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-slate-200">
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
