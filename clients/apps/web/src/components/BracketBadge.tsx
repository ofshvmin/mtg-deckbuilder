import { useState } from "react";
import type { BracketOut } from "@mtg/shared";

// Color scale: low brackets cool/green (casual), high brackets warm/red (spicy).
const TONE: Record<number, string> = {
  1: "border-slate-600 bg-slate-700/40 text-slate-200",
  2: "border-emerald-700 bg-emerald-900/30 text-emerald-300",
  3: "border-sky-700 bg-sky-900/30 text-sky-300",
  4: "border-orange-700 bg-orange-900/30 text-orange-300",
  5: "border-rose-700 bg-rose-900/30 text-rose-300",
};

export default function BracketBadge({
  bracket,
  compact = false,
}: {
  bracket: BracketOut;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tone = TONE[bracket.bracket] ?? TONE[2];

  if (compact) {
    return (
      <span
        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}
        title={`Bracket ${bracket.bracket} · ${bracket.label}`}
      >
        B{bracket.bracket}
      </span>
    );
  }

  return (
    <div className="inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${tone}`}
        title="How this bracket was estimated"
      >
        <span className="opacity-70">⚖</span>
        Bracket {bracket.bracket} · {bracket.label}
        <span className="opacity-60">{open ? "▲" : "▾"}</span>
      </button>

      {open && (
        <div className="mt-2 max-w-md rounded-lg border border-slate-800 bg-slate-900/90 p-3 text-left text-xs shadow-xl">
          <p className="text-slate-300">{bracket.explanation}</p>
          {bracket.signals.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {bracket.signals.map((s) => (
                <li key={s.key}>
                  <span className="font-medium text-slate-200">
                    {s.label} ({s.count}):
                  </span>{" "}
                  <span className="text-slate-400">{s.cards.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
          {bracket.caveat && (
            <p className="mt-2 border-t border-slate-800 pt-2 text-[11px] italic text-slate-500">
              {bracket.caveat}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
