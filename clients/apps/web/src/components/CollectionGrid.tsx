import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CollectionCard } from "@mtg/shared";
import {
  DEFAULT_DIR,
  availableCopies,
  cardValue,
  type SortDir,
  type SortKey,
} from "../lib/collectionFilter";
import CardDetailModal from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import ColorPips from "./ColorPips";
import ManaCost from "./ManaCost";
import PrintingChips from "./PrintingChips";

// Rows are rendered in pages rather than capped: with sorting, "the 400 most
// valuable cards" is a real answer, but a silent cut at 400 of an unsorted list
// was just a truncation. Show more extends it a page at a time.
const PAGE = 400;

function shortType(typeLine: string): string {
  return typeLine.split("—")[0].trim();
}

function money(value: number): string {
  if (value <= 0) return "—";
  return value >= 100 ? `$${Math.round(value).toLocaleString()}` : `$${value.toFixed(2)}`;
}

/** A clickable column header. Clicking the active column flips direction. */
function SortHeader({
  label,
  column,
  sort,
  dir,
  onSortChange,
  className = "",
}: {
  label: string;
  column: SortKey;
  sort: SortKey;
  dir: SortDir;
  onSortChange: (key: SortKey, dir: SortDir) => void;
  className?: string;
}) {
  const active = sort === column;
  return (
    <th className={"px-4 py-2 font-medium " + className}>
      <button
        onClick={() =>
          onSortChange(column, active ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[column])
        }
        className={
          "inline-flex items-center gap-1 uppercase tracking-wider transition " +
          (active ? "text-slate-200" : "hover:text-slate-300")
        }
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className={active ? "text-emerald-400" : "text-transparent"}>
          {active && dir === "desc" ? "↓" : "↑"}
        </span>
      </button>
    </th>
  );
}

export default function CollectionGrid({
  cards,
  totalOwned,
  sort,
  dir,
  onSortChange,
  onChanged,
  showAvailability,
}: {
  /** Already filtered and sorted by the page. */
  cards: CollectionCard[];
  /** Cards owned before filtering, for the footer count. */
  totalOwned: number;
  sort: SortKey;
  dir: SortDir;
  onSortChange: (key: SortKey, dir: SortDir) => void;
  onChanged: () => void;
  /** Show the Free column — only earns its width once you're filtering on it. */
  showAvailability?: boolean;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<CollectionCard | null>(null);
  const { hover, onEnter, onLeave } = useCardHover();

  // A new filter or sort means a new list; keep the page from starting scrolled
  // three pages deep into results the user hasn't seen.
  useEffect(() => {
    setLimit(PAGE);
  }, [cards, sort, dir]);

  const shown = cards.slice(0, limit);

  if (totalOwned === 0) {
    return <p className="text-sm text-slate-500">No cards in your collection yet.</p>;
  }

  return (
    <>
      <div className="rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="max-h-[36rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <SortHeader label="Name" column="name" sort={sort} dir={dir} onSortChange={onSortChange} />
                <SortHeader
                  label="Type" column="type" sort={sort} dir={dir} onSortChange={onSortChange}
                  className="hidden sm:table-cell"
                />
                <th className="hidden px-4 py-2 font-medium md:table-cell">Cost</th>
                <SortHeader
                  label="MV" column="cmc" sort={sort} dir={dir} onSortChange={onSortChange}
                  className="hidden sm:table-cell"
                />
                <SortHeader
                  label="ID" column="color" sort={sort} dir={dir} onSortChange={onSortChange}
                  className="hidden md:table-cell"
                />
                <SortHeader
                  label="Set" column="set" sort={sort} dir={dir} onSortChange={onSortChange}
                />
                <SortHeader
                  label="Value" column="value" sort={sort} dir={dir} onSortChange={onSortChange}
                  className="hidden text-right lg:table-cell"
                />
                {showAvailability && (
                  <th className="px-4 py-2 text-right font-medium" title="Copies not in an in-use deck">
                    Free
                  </th>
                )}
                <SortHeader
                  label="Owned" column="copies" sort={sort} dir={dir} onSortChange={onSortChange}
                  className="text-right"
                />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const free = availableCopies(c);
                return (
                  <tr
                    key={c.oracle_id}
                    className="cursor-pointer border-t border-slate-800/60 hover:bg-slate-800/40"
                    onClick={() => setSelected(c)}
                  >
                    <td
                      className="px-4 py-2 font-medium text-slate-100 hover:text-emerald-300"
                      onMouseEnter={(e) => onEnter(e, c.name, c.printings?.[0])}
                      onMouseLeave={onLeave}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {c.name}
                        {c.reserved && (
                          <span
                            title="Reserved List — will never be reprinted"
                            className="rounded border border-amber-700/60 px-1 text-[10px] font-medium uppercase leading-tight text-amber-500"
                          >
                            RL
                          </span>
                        )}
                        {c.game_changer && (
                          <span
                            title="Commander Game Changer"
                            className="rounded border border-sky-700/60 px-1 text-[10px] font-medium uppercase leading-tight text-sky-400"
                          >
                            GC
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="hidden px-4 py-2 text-slate-400 sm:table-cell">
                      {shortType(c.type_line)}
                    </td>
                    <td className="hidden px-4 py-2 md:table-cell">
                      <ManaCost cost={c.mana_cost} className="text-xs" />
                    </td>
                    <td className="hidden px-4 py-2 text-right tabular-nums text-slate-400 sm:table-cell">
                      {shortType(c.type_line).toLowerCase().includes("land") ? "—" : c.cmc}
                    </td>
                    <td className="hidden px-4 py-2 md:table-cell">
                      <ColorPips colors={c.color_identity} />
                    </td>
                    <td className="px-4 py-2">
                      <PrintingChips printings={c.printings} />
                    </td>
                    <td className="hidden px-4 py-2 text-right tabular-nums text-slate-400 lg:table-cell">
                      {money(cardValue(c))}
                    </td>
                    {showAvailability && (
                      <td
                        className={
                          "px-4 py-2 text-right tabular-nums " +
                          (free <= 0 ? "text-rose-400" : "text-emerald-400")
                        }
                        title={
                          free < 0
                            ? "Decks marked in use claim more copies than you own"
                            : undefined
                        }
                      >
                        {free}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                      {c.total_count}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    No cards match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
          <span>
            Showing {shown.length.toLocaleString()} of {cards.length.toLocaleString()}
            {cards.length !== totalOwned && ` (filtered from ${totalOwned.toLocaleString()})`}
          </span>
          {shown.length < cards.length && (
            <button
              onClick={() => setLimit((n) => n + PAGE)}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              Show {Math.min(PAGE, cards.length - shown.length).toLocaleString()} more
            </button>
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

      {selected && (
        <CardDetailModal
          card={selected}
          onClose={() => setSelected(null)}
          onRemoved={() => {
            setSelected(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}
