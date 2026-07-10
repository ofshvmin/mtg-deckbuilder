import type { Printing } from "@mtg/shared";

// Renders one small set-code chip per owned printing of a card — the physical
// locator detail (which box the paper card lives in). Foil printings are
// flagged; 3+ printings collapse to the first two plus a "+N" overflow chip.
// Hovering a chip reveals collector number · condition · count.

function chipTitle(p: Printing): string {
  const parts: string[] = [];
  if (p.collector_number) parts.push(`#${p.collector_number}`);
  if (p.finish === "foil") parts.push("foil");
  if (p.condition) parts.push(p.condition);
  if (p.count > 1) parts.push(`×${p.count}`);
  return parts.join(" · ");
}

function Chip({ printing }: { printing: Printing }) {
  const foil = printing.finish === "foil";
  return (
    <span
      title={chipTitle(printing)}
      className={
        "inline-flex shrink-0 items-center rounded border px-1 text-[10px] font-medium uppercase leading-tight " +
        (foil
          ? "border-amber-700/60 text-amber-500"
          : "border-slate-700 text-slate-500")
      }
    >
      {printing.edition || "—"}
      {foil && <span className="ml-0.5">✦</span>}
    </span>
  );
}

export default function PrintingChips({
  printings,
  max = 2,
}: {
  printings?: Printing[];
  max?: number;
}) {
  if (!printings || printings.length === 0) return null;
  const shown = printings.slice(0, max);
  const overflow = printings.length - shown.length;
  const overflowTitle =
    overflow > 0
      ? printings
          .slice(max)
          .map((p) => `${p.edition || "—"}${p.finish === "foil" ? " foil" : ""}`)
          .join(", ")
      : undefined;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((p) => (
        <Chip key={p.printing_key} printing={p} />
      ))}
      {overflow > 0 && (
        <span
          title={overflowTitle}
          className="inline-flex shrink-0 items-center rounded border border-slate-700 px-1 text-[10px] font-medium leading-tight text-slate-500"
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
