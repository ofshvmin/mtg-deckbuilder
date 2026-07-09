import type { Color } from "@mtg/shared";
import { COLOR_PIP, orderColors } from "../lib/format";

export default function ColorPips({ colors }: { colors: Color[] }) {
  const ordered = orderColors(colors);
  if (ordered.length === 0) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-600 text-[10px] font-bold text-white">
        C
      </span>
    );
  }
  return (
    <span className="inline-flex gap-0.5">
      {ordered.map((c) => (
        <span
          key={c}
          className={
            "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold " +
            COLOR_PIP[c]
          }
        >
          {c}
        </span>
      ))}
    </span>
  );
}
