import type { PoolScope } from "@mtg/shared";
import SetPicker from "./SetPicker";

// Which cards a build is allowed to draw on. Two independent narrowings, applied
// in the order Danko thinks about them: first "don't offer me cards that are
// already sleeved up in another deck", then "and only from these sets".
//
// Both default to off, so a build with these controls untouched is the whole
// collection — exactly what the app did before pools were a thing.
//
// The set list itself is SetPicker, shared with the collection browser.

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

        <SetPicker
          sets={sets}
          onChange={onSetsChange}
          countKey={scope === "available" ? "available" : "owned"}
          disabled={disabled}
        />
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
