import type { Color } from "@mtg/shared";

/** "{2}{B}{R}" -> "2 B R" (compact, brace-free) for display. */
export function formatManaCost(cost: string): string {
  const symbols = cost.match(/\{([^}]+)\}/g);
  if (!symbols) return "";
  return symbols.map((s) => s.slice(1, -1)).join(" ");
}

/** Tailwind classes for a color-identity pip. */
export const COLOR_PIP: Record<Color, string> = {
  W: "bg-amber-200 text-amber-950",
  U: "bg-sky-500 text-white",
  B: "bg-neutral-700 text-white",
  R: "bg-red-500 text-white",
  G: "bg-emerald-600 text-white",
};

export const COLOR_ORDER: Color[] = ["W", "U", "B", "R", "G"];

export function orderColors(colors: Color[]): Color[] {
  return COLOR_ORDER.filter((c) => colors.includes(c));
}

/** ["B","R","G"] -> "BRG"; empty -> "C" (colorless). */
export function formatColorIdentity(colors: Color[]): string {
  const ordered = orderColors(colors);
  return ordered.length ? ordered.join("") : "C";
}
