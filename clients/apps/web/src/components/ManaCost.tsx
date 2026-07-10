import { formatManaCost } from "../lib/format";

// Renders a mana cost string like "{2}{B}{R}" as authentic MTG mana symbols
// using the mana-font glyphs (ms-cost = the rounded colored pip, ms-shadow =
// the printed drop shadow). Falls back to nothing for empty costs.

/** Map a single symbol's inner text (e.g. "B", "2", "U/R", "B/P", "T") to a mana-font class. */
export function manaSymbolClass(inner: string): string {
  const s = inner.trim().toUpperCase();
  if (s === "T") return "ms-tap";
  if (s === "Q") return "ms-untap";
  if (s === "∞") return "ms-infinity";
  if (s === "½") return "ms-half";
  // Hybrid / phyrexian collapse the slash: "U/R" -> "ur", "2/W" -> "2w", "B/P" -> "bp".
  return "ms-" + s.replace(/\//g, "").toLowerCase();
}

export default function ManaCost({
  cost,
  className = "",
}: {
  cost: string;
  className?: string;
}) {
  const symbols = cost.match(/\{([^}]+)\}/g);
  if (!symbols || symbols.length === 0) return null;
  return (
    <span
      className={"inline-flex items-center gap-0.5 align-middle " + className}
      title={formatManaCost(cost)}
      aria-label={formatManaCost(cost)}
    >
      {symbols.map((sym, i) => (
        <i key={i} className={`ms ${manaSymbolClass(sym.slice(1, -1))} ms-cost ms-shadow`} />
      ))}
    </span>
  );
}
