import type { Color } from "./types";

/** WUBRG — the order mana symbols are always shown in. */
export const COLOR_ORDER: Color[] = ["W", "U", "B", "R", "G"];

export function orderColors(colors: Color[]): Color[] {
  return COLOR_ORDER.filter((c) => colors.includes(c));
}
