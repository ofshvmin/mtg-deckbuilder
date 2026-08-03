import { useEffect, useMemo, useRef, useState } from "react";
import type { CollectionSet, PoolScope } from "@mtg/shared";
import { api } from "../lib/api";
import { lookupSet, useScryfallSets } from "../lib/scryfallSets";

// Which cards a build is allowed to draw on. Two independent narrowings, applied
// in the order Danko thinks about them: first "don't offer me cards that are
// already sleeved up in another deck", then "and only from these sets".
//
// Both default to off, so a build with these controls untouched is the whole
// collection — exactly what the app did before pools were a thing.

export default function PoolControls({
  scope,
  onScopeChange,
  sets,
  onSetsChange,
  disabled,
}: {
  scope: PoolScope;
  onScopeChange: (next: PoolScope) => void;
  sets: string[];
  onSetsChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [available, setAvailable] = useState<CollectionSet[] | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const setIndex = useScryfallSets();
  const popover = useRef<HTMLDivElement>(null);

  // Loaded lazily: the picker is a secondary control, and the counts it shows go
  // stale the moment a deck is marked in use, so fetching on open keeps it honest.
  useEffect(() => {
    if (!open || available) return;
    api
      .listCollectionSets()
      .then(setAvailable)
      .catch(() => setAvailable([]));
  }, [open, available]);

  // Reopening after marking a deck in use should show fresh availability counts.
  useEffect(() => {
    setAvailable(null);
  }, [scope]);

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
    onSetsChange([...next]);
  }

  const label =
    sets.length === 0
      ? "All sets"
      : sets.length === 1
        ? setName(sets[0])
        : `${sets.length} sets`;

  function setName(code: string): string {
    const fromCatalog = lookupSet(setIndex, code)?.name;
    const fromCollection = (available ?? []).find((s) => s.code === code)?.name;
    return fromCatalog ?? fromCollection ?? code.toUpperCase();
  }

  const toggleClass = (active: boolean) =>
    "rounded-md px-3 py-1.5 text-sm transition " +
    (active ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200");

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
        Card pool
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-700 p-0.5">
          <button
            onClick={() => onScopeChange("owned")}
            disabled={disabled}
            className={toggleClass(scope === "owned")}
            title="Every card in your collection"
          >
            All owned
          </button>
          <button
            onClick={() => onScopeChange("available")}
            disabled={disabled}
            className={toggleClass(scope === "available")}
            title="Only cards that aren't already in a deck you've marked as in use"
          >
            Available only
          </button>
        </div>

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
            <div className="absolute left-0 z-30 mt-2 w-80 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
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
                  onClick={() => onSetsChange([])}
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
                  const count = scope === "available" ? s.available : s.owned;
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
                        className={
                          "shrink-0 text-xs " + (count > 0 ? "text-slate-500" : "text-slate-600")
                        }
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
      </div>
      <p className="text-xs text-slate-500">
        {scope === "available"
          ? "Skipping cards already in a deck marked “in use”."
          : "Drawing on your whole collection."}
        {sets.length > 0 && " Basic lands are always available regardless of set."}
      </p>
    </div>
  );
}
