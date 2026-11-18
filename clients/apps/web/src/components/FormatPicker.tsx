import { useRef } from "react";
import type { CatalogFormat, FormatFamily } from "@mtg/shared";

// The format picker as two decisions: the family first (it decides most of the
// build screen — commander search or not, who picks colors), then the format
// within it. The top row never grows past two segments; new formats only add
// chips, which wrap.

const FAMILIES: { key: FormatFamily; label: string }[] = [
  { key: "commander", label: "Commander" },
  { key: "constructed", label: "60-card" },
];

export default function FormatPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: CatalogFormat[];
  value: string;
  onChange: (key: string) => void;
}) {
  const current = catalog.find((f) => f.key === value);
  const family = current?.family ?? "commander";
  // The last format picked in each family, so Commander → 60-card → Commander
  // lands back on the format you left rather than the family's first.
  const lastPick = useRef<Partial<Record<FormatFamily, string>>>({});
  lastPick.current[family] = value;

  function selectFamily(next: FormatFamily) {
    if (next === family) return;
    const remembered = lastPick.current[next];
    const first = catalog.find((f) => f.family === next && f.available);
    const key = remembered ?? first?.key;
    if (key) onChange(key);
  }

  const inFamily = catalog.filter((f) => f.family === family);

  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">Format</label>
      <div className="mt-2 inline-flex rounded-lg border border-slate-700 p-0.5">
        {FAMILIES.map((f) => (
          <button
            key={f.key}
            onClick={() => selectFamily(f.key)}
            aria-pressed={family === f.key}
            className={
              "min-w-28 rounded-md px-4 py-1.5 text-sm transition " +
              (family === f.key ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {inFamily.map((f) =>
          f.available ? (
            <button
              key={f.key}
              onClick={() => f.key !== value && onChange(f.key)}
              aria-pressed={f.key === value}
              className={
                "rounded-full border px-3 py-1 text-sm transition " +
                (f.key === value
                  ? "border-emerald-600 bg-emerald-600/20 text-emerald-300"
                  : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200")
              }
            >
              {f.label}
            </button>
          ) : (
            <span
              key={f.key}
              title="Coming soon"
              className="cursor-default rounded-full border border-dashed border-slate-800 px-3 py-1 text-sm text-slate-600"
            >
              {f.label} <span className="text-xs uppercase tracking-wider">soon</span>
            </span>
          ),
        )}
      </div>

      {current && (
        <p className="mt-2 text-xs text-slate-500">
          {current.description}
          {current.deck_size !== undefined &&
            ` · ${current.deck_size} cards · up to ${current.max_copies} cop${current.max_copies === 1 ? "y" : "ies"} of each`}
          {current.legal_owned !== undefined && (
            <>
              {" · "}
              <span className="text-slate-300">{current.legal_owned.toLocaleString()}</span> of your cards
              are legal
            </>
          )}
        </p>
      )}
    </div>
  );
}
