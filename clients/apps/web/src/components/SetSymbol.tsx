// A set's Scryfall icon rendered as a crisp logo badge. Scryfall set SVGs are
// black, so we place them on a light rounded chip to read well on the dark UI.
// Falls back to a neutral placeholder when no icon is available.
export default function SetSymbol({
  iconUri,
  code,
  className = "h-10 w-10",
}: {
  iconUri?: string;
  code?: string | null;
  className?: string;
}) {
  if (!iconUri) {
    return (
      <span
        className={
          "inline-flex items-center justify-center rounded-lg bg-slate-800 text-[10px] font-semibold uppercase text-slate-400 " +
          className
        }
      >
        {(code || "?").slice(0, 4)}
      </span>
    );
  }
  return (
    <span className={"inline-flex items-center justify-center rounded-lg bg-slate-200 p-1.5 " + className}>
      <img src={iconUri} alt={code ? `${code} set symbol` : "set symbol"} className="h-full w-full object-contain" />
    </span>
  );
}
