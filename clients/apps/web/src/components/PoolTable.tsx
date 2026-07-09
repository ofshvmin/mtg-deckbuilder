import { useMemo, useState } from "react";
import type { PoolCard } from "@mtg/shared";
import { formatManaCost } from "../lib/format";
import ColorPips from "./ColorPips";

const DISPLAY_CAP = 300;

// Short type: "Legendary Creature — Dragon" -> "Legendary Creature"
function shortType(typeLine: string): string {
  return typeLine.split("—")[0].trim();
}

export default function PoolTable({ pool }: { pool: PoolCard[] }) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const rows = f ? pool.filter((c) => c.name.toLowerCase().includes(f)) : pool;
    return rows;
  }, [pool, filter]);

  const shown = filtered.slice(0, DISPLAY_CAP);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
          Legal pool
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name…"
          className="w-56 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-500"
        />
      </div>

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Cost</th>
              <th className="px-4 py-2 text-right font-medium">MV</th>
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 text-right font-medium">Owned</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.oracle_id} className="border-t border-slate-800/60 hover:bg-slate-800/40">
                <td className="px-4 py-2 text-slate-100">{c.name}</td>
                <td className="px-4 py-2 text-slate-400">{shortType(c.type_line)}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-300">
                  {formatManaCost(c.mana_cost)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                  {c.is_land ? "—" : c.cmc}
                </td>
                <td className="px-4 py-2">
                  <ColorPips colors={c.color_identity} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                  {c.copies_owned}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-800 px-4 py-2 text-xs text-slate-500">
        Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
        {filtered.length !== pool.length && ` (filtered from ${pool.length.toLocaleString()})`}
        {filtered.length > DISPLAY_CAP && " — refine the filter to see more"}
      </div>
    </div>
  );
}
