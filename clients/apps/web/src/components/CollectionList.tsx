import { useState } from "react";
import type { CollectionItem, Printing } from "@mtg/shared";
import { api } from "../lib/api";
import PrintingChips from "./PrintingChips";

// Adapt a collection row to the printing-chip shape (single owned printing).
function itemPrintings(item: CollectionItem): Printing[] {
  if (!item.edition) return [];
  return [
    {
      printing_key: `${item.edition}|${item.condition ?? ""}|${item.foil ? "foil" : "nonfoil"}`,
      edition: item.edition,
      collector_number: null,
      finish: item.foil ? "foil" : "nonfoil",
      condition: item.condition ?? null,
      language: null,
      count: item.count,
    },
  ];
}

export default function CollectionList({
  items,
  onRemoved,
}: {
  items: CollectionItem[];
  onRemoved: () => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);

  async function handleRemove(oracleId: string) {
    setRemoving(oracleId);
    try {
      await api.removeCard(oracleId);
      onRemoved();
    } catch {
      // silent
    } finally {
      setRemoving(null);
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-slate-500">No cards in your collection yet.</p>;
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Collection
        </span>
        <span className="text-xs tabular-nums text-slate-500">
          {items.length} cards · {items.reduce((s, i) => s + i.count, 0)} total
        </span>
      </div>
      <ul className="divide-y divide-slate-800/60 max-h-[600px] overflow-y-auto">
        {items.map((item, idx) => (
          <li
            key={`${item.oracle_id ?? item.name}-${idx}`}
            className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              {item.count > 1 && (
                <span className="shrink-0 text-slate-500">{item.count}x</span>
              )}
              <span className="truncate text-slate-200">{item.name}</span>
              <PrintingChips printings={itemPrintings(item)} />
              {!item.oracle_id && (
                <span className="shrink-0 text-xs text-rose-500">unmatched</span>
              )}
            </div>
            {item.oracle_id && (
              <button
                onClick={() => handleRemove(item.oracle_id!)}
                disabled={removing === item.oracle_id}
                className="shrink-0 text-xs text-slate-600 hover:text-rose-400 disabled:opacity-50"
                title="Remove from collection"
              >
                {removing === item.oracle_id ? "…" : "✕"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
