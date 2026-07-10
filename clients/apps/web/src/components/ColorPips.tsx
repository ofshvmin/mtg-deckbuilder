import type { Color } from "@mtg/shared";
import { orderColors } from "../lib/format";

// Color identity as authentic MTG mana symbols (mana-font). Colorless / no
// identity renders the colorless pip. `ms-cost` gives the rounded colored disc,
// `ms-shadow` the printed drop shadow.
const MS_CLASS: Record<Color, string> = {
  W: "ms-w",
  U: "ms-u",
  B: "ms-b",
  R: "ms-r",
  G: "ms-g",
};

export default function ColorPips({ colors }: { colors: Color[] }) {
  const ordered = orderColors(colors);
  const symbols = ordered.length ? ordered.map((c) => MS_CLASS[c]) : ["ms-c"];
  return (
    <span className="inline-flex items-center gap-0.5 align-middle text-[15px] leading-none">
      {symbols.map((cls, i) => (
        <i key={i} className={`ms ${cls} ms-cost ms-shadow`} />
      ))}
    </span>
  );
}
