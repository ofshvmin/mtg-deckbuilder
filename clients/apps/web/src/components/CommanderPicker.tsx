import { useEffect, useRef, useState } from "react";
import type { CommanderOption } from "@mtg/shared";
import { api } from "../lib/api";
import ColorPips from "./ColorPips";

export default function CommanderPicker({
  onSelect,
}: {
  onSelect: (commander: CommanderOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommanderOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search on the query.
  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await api.searchCommanders(query));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Search your commanders…"
        className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {loading && <div className="px-3 py-2 text-sm text-slate-500">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-500">No matching owned commanders.</div>
          )}
          {results.map((c) => (
            <button
              key={c.oracle_id}
              onClick={() => {
                onSelect(c);
                setQuery(c.name);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-800"
            >
              <span className="text-slate-100">{c.name}</span>
              <ColorPips colors={c.color_identity} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
