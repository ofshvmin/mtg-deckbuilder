import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CollectionCard } from "@mtg/shared";
import CardDetailModal from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import ColorPips from "./ColorPips";
import ManaCost from "./ManaCost";
import PrintingChips from "./PrintingChips";

const DISPLAY_CAP = 400;

function shortType(typeLine: string): string {
  return typeLine.split("—")[0].trim();
}

export default function CollectionGrid({
  cards,
  onChanged,
}: {
  cards: CollectionCard[];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<CollectionCard | null>(null);
  const { hover, onEnter, onLeave } = useCardHover();

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? cards.filter((c) => c.name.toLowerCase().includes(f)) : cards;
  }, [cards, filter]);

  const shown = filtered.slice(0, DISPLAY_CAP);

  if (cards.length === 0) {
    return <p className="text-sm text-slate-500">No cards in your collection yet.</p>;
  }

  return (
    <>
      <div className="rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Collection
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name…"
            className="w-56 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
          />
        </div>

        <div className="max-h-[36rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Type</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Cost</th>
                <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">MV</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">ID</th>
                <th className="px-4 py-2 font-medium">Printings</th>
                <th className="px-4 py-2 text-right font-medium">Owned</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
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
                    {c.name}
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
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                    {c.total_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
          Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
          {filtered.length !== cards.length && ` (filtered from ${cards.length.toLocaleString()})`}
          {filtered.length > DISPLAY_CAP && " — refine the filter to see more"}
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
