import { useState } from "react";
import type { Color } from "@mtg/shared";
import {
  CARD_TYPES,
  DEFAULT_DIR,
  EMPTY_FILTERS,
  RARITIES,
  SORT_LABELS,
  isFiltered,
  type ColorMode,
  type FilterState,
  type SortDir,
  type SortKey,
} from "../lib/collectionFilter";
import { COLOR_ORDER } from "../lib/format";
import SetPicker from "./SetPicker";

// The collection browser's controls.
//
// Two rows always visible — search, sets, colors, sort — with everything else
// behind "More filters", because a wall of sixteen controls is its own kind of
// unusable. What is never hidden is the *state*: whatever is currently narrowing
// the table shows as a removable chip underneath, so a table missing three
// thousand cards always says why. A filter you can't see is a bug report.

const MODE_LABELS: Record<ColorMode, string> = {
  any: "Any of",
  exact: "Exactly",
  atMost: "At most",
};

const MODE_HINTS: Record<ColorMode, string> = {
  any: "Cards including at least one of the selected colors",
  exact: "Cards whose colors are exactly the selection",
  atMost: "Cards that fit inside the selection — what's legal in that deck",
};

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        "rounded-full border px-2.5 py-1 text-xs transition " +
        (active
          ? "border-emerald-600 bg-emerald-600/20 text-emerald-300"
          : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200")
      }
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Caveat about what the control actually means, on the label rather than as a
   *  stray icon among the chips. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className={
          "text-xs font-medium uppercase tracking-wider text-slate-500 " +
          (hint ? "cursor-help decoration-dotted underline-offset-4 hover:underline" : "")
        }
        title={hint}
      >
        {label}
        {hint && <span className="ml-1 normal-case text-slate-600">ⓘ</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500";

export default function CollectionFilters({
  filters,
  onChange,
  sort,
  dir,
  onSortChange,
  activeCount,
  totalCount,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  sort: SortKey;
  dir: SortDir;
  onSortChange: (key: SortKey, dir: SortDir) => void;
  /** Cards passing the filters, and cards owned — for the "showing N of M" line. */
  activeCount: number;
  totalCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  function toggleIn<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function toggleColor(c: Color) {
    set({ colors: toggleIn(filters.colors, c) });
  }

  const narrowed = isFiltered(filters);

  // Every active narrowing, as one removable chip each.
  const active: { key: string; label: string; clear: () => void }[] = [];
  if (filters.q.trim()) {
    active.push({ key: "q", label: `“${filters.q.trim()}”`, clear: () => set({ q: "" }) });
  }
  if (filters.sets.length) {
    active.push({
      key: "sets",
      label: filters.sets.length === 1 ? filters.sets[0].toUpperCase() : `${filters.sets.length} sets`,
      clear: () => set({ sets: [] }),
    });
  }
  if (filters.colors.length || filters.colorless) {
    const pips = [...filters.colors].sort(
      (a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b),
    ).join("");
    active.push({
      key: "colors",
      label: `${MODE_LABELS[filters.colorMode]} ${pips}${filters.colorless ? "C" : ""}`,
      clear: () => set({ colors: [], colorless: false }),
    });
  }
  for (const t of filters.types) {
    active.push({ key: `type-${t}`, label: t, clear: () => set({ types: toggleIn(filters.types, t) }) });
  }
  for (const r of filters.rarities) {
    active.push({
      key: `rarity-${r}`,
      label: r,
      clear: () => set({ rarities: toggleIn(filters.rarities, r) }),
    });
  }
  if (filters.cmcMin !== null || filters.cmcMax !== null) {
    active.push({
      key: "mv",
      label: `MV ${filters.cmcMin ?? 0}–${filters.cmcMax ?? "∞"}`,
      clear: () => set({ cmcMin: null, cmcMax: null }),
    });
  }
  if (filters.finish !== "any") {
    active.push({ key: "finish", label: filters.finish, clear: () => set({ finish: "any" }) });
  }
  if (filters.availability !== "owned") {
    active.push({
      key: "avail",
      label: "Available only",
      clear: () => set({ availability: "owned" }),
    });
  }
  if (filters.minCopies !== null) {
    active.push({
      key: "copies",
      label: `${filters.minCopies}+ copies`,
      clear: () => set({ minCopies: null }),
    });
  }
  if (filters.reservedOnly) {
    active.push({ key: "reserved", label: "Reserved List", clear: () => set({ reservedOnly: false }) });
  }
  if (filters.gameChangersOnly) {
    active.push({
      key: "gc",
      label: "Game Changers",
      clear: () => set({ gameChangersOnly: false }),
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search name, type, or rules text…"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-500 sm:max-w-sm"
        />

        <SetPicker
          sets={filters.sets}
          onChange={(sets) => set({ sets })}
          countKey={filters.availability === "available" ? "available" : "owned"}
        />

        <div className="flex items-center gap-1">
          {COLOR_ORDER.map((c) => (
            <button
              key={c}
              onClick={() => toggleColor(c)}
              aria-pressed={filters.colors.includes(c)}
              title={c}
              className={
                "h-7 w-7 rounded-full text-xs font-semibold transition " +
                (filters.colors.includes(c)
                  ? "bg-slate-700 text-slate-100 ring-2 ring-emerald-500"
                  : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300")
              }
            >
              {c}
            </button>
          ))}
          <button
            onClick={() => set({ colorless: !filters.colorless })}
            aria-pressed={filters.colorless}
            title="Colorless"
            className={
              "h-7 w-7 rounded-full text-xs font-semibold transition " +
              (filters.colorless
                ? "bg-slate-700 text-slate-100 ring-2 ring-emerald-500"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300")
            }
          >
            C
          </button>
        </div>

        <select
          value={filters.colorMode}
          onChange={(e) => set({ colorMode: e.target.value as ColorMode })}
          title={MODE_HINTS[filters.colorMode]}
          className={selectClass}
        >
          {(Object.keys(MODE_LABELS) as ColorMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1">
          <select
            value={sort}
            onChange={(e) => {
              const key = e.target.value as SortKey;
              onSortChange(key, DEFAULT_DIR[key]);
            }}
            className={selectClass}
            aria-label="Sort by"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            onClick={() => onSortChange(sort, dir === "asc" ? "desc" : "asc")}
            title={dir === "asc" ? "Ascending" : "Descending"}
            aria-label={`Sort ${dir === "asc" ? "ascending" : "descending"}`}
            className="rounded-lg border border-slate-700 px-2 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className={
              "rounded-lg border px-3 py-1.5 text-sm transition " +
              (expanded
                ? "border-slate-500 text-slate-100"
                : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200")
            }
          >
            More filters {expanded ? "▴" : "▾"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid gap-4 border-t border-slate-800 pt-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Type">
            {CARD_TYPES.map((t) => (
              <Chip
                key={t}
                active={filters.types.includes(t)}
                onClick={() => set({ types: toggleIn(filters.types, t) })}
              >
                {t}
              </Chip>
            ))}
          </Field>

          <Field
            label="Rarity"
            hint="Rarity comes from the card's representative printing, so a card reprinted at another rarity reads as one value."
          >
            {RARITIES.map((r) => (
              <Chip
                key={r}
                active={filters.rarities.includes(r)}
                onClick={() => set({ rarities: toggleIn(filters.rarities, r) })}
                title={
                  r === "special"
                    ? "Scryfall's special and bonus rarities (Timeshifted, bonus sheets)"
                    : undefined
                }
              >
                {r}
              </Chip>
            ))}
          </Field>

          <Field label="Mana value">
            <input
              type="number"
              min={0}
              value={filters.cmcMin ?? ""}
              onChange={(e) =>
                set({ cmcMin: e.target.value === "" ? null : Number(e.target.value) })
              }
              placeholder="min"
              className="w-16 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-100 outline-none focus:border-emerald-500"
            />
            <span className="text-slate-600">–</span>
            <input
              type="number"
              min={0}
              value={filters.cmcMax ?? ""}
              onChange={(e) =>
                set({ cmcMax: e.target.value === "" ? null : Number(e.target.value) })
              }
              placeholder="max"
              className="w-16 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-100 outline-none focus:border-emerald-500"
            />
          </Field>

          <Field label="Availability">
            <Chip
              active={filters.availability === "owned"}
              onClick={() => set({ availability: "owned" })}
              title="Everything in your collection"
            >
              All owned
            </Chip>
            <Chip
              active={filters.availability === "available"}
              onClick={() => set({ availability: "available" })}
              title="Only copies not already in a deck marked in use"
            >
              Available only
            </Chip>
          </Field>

          <Field label="Finish">
            {(["any", "nonfoil", "foil"] as const).map((f) => (
              <Chip key={f} active={filters.finish === f} onClick={() => set({ finish: f })}>
                {f === "any" ? "Either" : f}
              </Chip>
            ))}
          </Field>

          <Field label="Copies owned">
            {[2, 4].map((n) => (
              <Chip
                key={n}
                active={filters.minCopies === n}
                onClick={() => set({ minCopies: filters.minCopies === n ? null : n })}
                title={n === 4 ? "Playsets" : "Duplicates"}
              >
                {n}+
              </Chip>
            ))}
          </Field>

          <Field label="Lists">
            <Chip
              active={filters.reservedOnly}
              onClick={() => set({ reservedOnly: !filters.reservedOnly })}
              title="On WOTC's Reserved List — these will never be reprinted"
            >
              Reserved List
            </Chip>
            <Chip
              active={filters.gameChangersOnly}
              onClick={() => set({ gameChangersOnly: !filters.gameChangersOnly })}
              title="On WOTC's Commander Game Changers list"
            >
              Game Changers
            </Chip>
          </Field>

          <Field label="Colors read from">
            <Chip
              active={filters.colorSource === "identity"}
              onClick={() => set({ colorSource: "identity" })}
              title="Color identity — what a commander's deck may contain"
            >
              Identity
            </Chip>
            <Chip
              active={filters.colorSource === "colors"}
              onClick={() => set({ colorSource: "colors" })}
              title="The card's own colors, ignoring identity from rules text"
            >
              Card colors
            </Chip>
          </Field>
        </div>
      )}

      {narrowed && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800 pt-3">
          <span className="text-xs text-slate-500">
            {activeCount.toLocaleString()} of {totalCount.toLocaleString()} cards
          </span>
          {active.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.clear}
              className="group rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300 transition hover:border-rose-700 hover:text-rose-300"
              title="Remove this filter"
            >
              {chip.label}
              <span className="ml-1.5 text-slate-500 group-hover:text-rose-400">✕</span>
            </button>
          ))}
          <button
            onClick={() => onChange(EMPTY_FILTERS)}
            className="ml-1 text-xs text-slate-500 underline underline-offset-2 transition hover:text-slate-300"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
