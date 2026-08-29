import { useEffect, useMemo, useRef, useState } from "react";
import type { CollectionSet } from "@mtg/shared";
import { api } from "../lib/api";
import { lookupSet, useScryfallSets } from "../lib/scryfallSets";

// A multi-select over the sets in your collection — "which of my shelves?".
//
// Extracted from the build screen's PoolControls when the collection browser
// needed the same control. Both ask the same question of the same endpoint, and
// the counts, the Scryfall name/icon lookup and the click-away handling are the
// fiddly parts worth having in one place.
//
// Set rows are fetched on first open rather than on mount: it's a secondary
// control, and the counts go stale the moment a deck is marked in use.

export default function SetPicker({
  sets,
  onChange,
  countKey = "owned",
  disabled,
  align = "left",
}: {
  /** Selected set codes, lowercase. */
  sets: string[];
  onChange: (next: string[]) => void;
  /** Which number to show per set — copies owned, or copies still free. */
  countKey?: "owned" | "available";
  disabled?: boolean;
  /** Which edge the popover hangs from, for pickers near the right margin. */
  align?: "left" | "right";
}) {
  const [available, setAvailable] = useState<CollectionSet[] | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const setIndex = useScryfallSets();
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || available) return;
    api.listCollectionSets().then(setAvailable).catch(() => setAvailable([]));
  }, [open, available]);

  // Reopening after marking a deck in use should show fresh availability counts.
  useEffect(() => {
    setAvailable(null);
  }, [countKey]);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (popover.current && !popover.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const selected = useMemo(() => new Set(sets), [sets]);

  const visible = useMemo(() => {
    const rows = available ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [available, filter]);

  function toggleSet(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange([...next]);
  }

  function setName(code: string): string {
    const fromCatalog = lookupSet(setIndex, code)?.name;
    const fromCollection = (available ?? []).find((s) => s.code === code)?.name;
    return fromCatalog ?? fromCollection ?? code.toUpperCase();
  }

  const label =
    sets.length === 0 ? "All sets" : sets.length === 1 ? setName(sets[0]) : `${sets.length} sets`;

  return (
    <div className="relative" ref={popover}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={
          "rounded-lg border px-3 py-1.5 text-sm transition " +
          (sets.length > 0
            ? "border-emerald-600 bg-emerald-600/20 text-emerald-300"
            : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200")
        }
      >
        {label} <span className="text-xs">▾</span>
      </button>

      {open && (
        <div
          className={
            "absolute z-30 mt-2 w-80 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl " +
            (align === "right" ? "right-0" : "left-0")
          }
        >
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sets…"
            autoFocus
            className="mb-2 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
          />
          {sets.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="mb-2 w-full rounded-md px-2 py-1 text-left text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              ✕ Clear ({sets.length} selected)
            </button>
          )}
          <div className="max-h-72 overflow-y-auto">
            {available === null && <p className="p-2 text-sm text-slate-500">Loading sets…</p>}
            {available !== null && visible.length === 0 && (
              <p className="p-2 text-sm text-slate-500">
                {available.length === 0 ? "No sets in your collection." : "No matching sets."}
              </p>
            )}
            {visible.map((s) => {
              const icon = lookupSet(setIndex, s.code)?.iconSvgUri;
              const count = countKey === "available" ? s.available : s.owned;
              return (
                <label
                  key={s.code}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(s.code)}
                    onChange={() => toggleSet(s.code)}
                    className="accent-emerald-500"
                  />
                  {icon && <img src={icon} alt="" className="h-4 w-4 shrink-0 invert" />}
                  <span className="min-w-0 flex-1 truncate text-slate-200">
                    {lookupSet(setIndex, s.code)?.name ?? s.name}
                  </span>
                  <span
                    className={"shrink-0 text-xs " + (count > 0 ? "text-slate-500" : "text-slate-600")}
                  >
                    {count}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
