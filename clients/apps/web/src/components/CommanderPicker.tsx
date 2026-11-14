import { useEffect, useState } from "react";
import type { CommanderOption } from "@mtg/shared";
import { api } from "../lib/api";
import ColorPips from "./ColorPips";

const COLOR_TOGGLES: { key: string; label: string; cls: string }[] = [
  { key: "W", label: "White", cls: "ms-w" },
  { key: "U", label: "Blue", cls: "ms-u" },
  { key: "B", label: "Black", cls: "ms-b" },
  { key: "R", label: "Red", cls: "ms-r" },
  { key: "G", label: "Green", cls: "ms-g" },
  { key: "C", label: "Colorless", cls: "ms-c" },
];

const MANA_VALUES = [1, 2, 3, 4, 5, 6];

// One more than we show, so we can tell "that's all of them" from "there's more".
const BROWSE_LIMIT = 60;

/**
 * Commander search plus filters (exact color identity, a {C} pip in the cost,
 * max mana value, creature type). Results are an inline list rather than a dropdown so the filters alone
 * are enough to browse — no name required.
 */
export default function CommanderPicker({
  onSelect,
}: {
  onSelect: (commander: CommanderOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [colors, setColors] = useState<string[]>([]);
  const [maxMv, setMaxMv] = useState<number | null>(null);
  const [creatureType, setCreatureType] = useState("");
  const [results, setResults] = useState<CommanderOption[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const hasFilters = colors.length > 0 || maxMv !== null || creatureType.trim() !== "";

  // Debounced search on the query and filters.
  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const found = await api.searchCommanders(query, BROWSE_LIMIT + 1, {
          colors,
          max_mv: maxMv,
          creature_type: creatureType,
        });
        setTruncated(found.length > BROWSE_LIMIT);
        setResults(found.slice(0, BROWSE_LIMIT));
      } catch {
        setResults([]);
        setTruncated(false);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, colors, maxMv, creatureType]);

  // Kept in WUBRGC order so the query string is stable however they were clicked.
  // C combines with colors — it asks for a {C} pip in the cost (Ulalek is WUBRG + C).
  function toggleColor(key: string) {
    setOpen(true);
    setColors(
      COLOR_TOGGLES.map((c) => c.key).filter((c) => (c === key ? !colors.includes(c) : colors.includes(c))),
    );
  }

  function clearFilters() {
    setColors([]);
    setMaxMv(null);
    setCreatureType("");
  }

  const labelClass = "text-xs font-medium uppercase tracking-wider text-slate-400";

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search your commanders…"
        className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className={labelClass}>Colors</span>
          <div className="flex gap-1">
            {COLOR_TOGGLES.map((c) => {
              const on = colors.includes(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => toggleColor(c.key)}
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={on}
                  className={
                    "rounded-full p-0.5 text-[18px] leading-none transition " +
                    (on ? "ring-2 ring-emerald-400" : "opacity-35 grayscale hover:opacity-70")
                  }
                >
                  <i className={`ms ${c.cls} ms-cost ms-shadow`} />
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <span className={labelClass}>Mana value</span>
          <select
            value={maxMv ?? ""}
            onChange={(e) => {
              setMaxMv(e.target.value === "" ? null : Number(e.target.value));
              setOpen(true);
            }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200"
          >
            <option value="">Any</option>
            {MANA_VALUES.map((mv) => (
              <option key={mv} value={mv}>
                {mv} or less
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <span className={labelClass}>Creature type</span>
          <input
            value={creatureType}
            onChange={(e) => {
              setCreatureType(e.target.value);
              setOpen(true);
            }}
            placeholder="e.g. Elf, Dragon"
            className="w-32 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-500"
          />
        </label>

        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-slate-400 underline hover:text-slate-200">
            Clear filters
          </button>
        )}
      </div>

      {open && (
        <div className="max-h-80 overflow-auto rounded-lg border border-slate-700 bg-slate-900">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-500">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-500">
              {hasFilters ? "No owned commanders match these filters." : "No matching owned commanders."}
            </div>
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
              <span className="min-w-0">
                <span className="block text-slate-100">{c.name}</span>
                <span className="block truncate text-xs text-slate-500">{c.type_line}</span>
              </span>
              <ColorPips colors={c.color_identity} />
            </button>
          ))}
          {truncated && (
            <div className="px-3 py-2 text-xs text-slate-500">
              Showing the first {BROWSE_LIMIT} — narrow the filters or search by name to see more.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
