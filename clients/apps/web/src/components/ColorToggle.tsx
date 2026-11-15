// One mana-symbol toggle — the color filter button used everywhere a color can
// be picked (commander picker, build colors, collection browser), so every
// color filter on the site looks and behaves the same.

export const COLOR_TOGGLES: { key: string; label: string; cls: string }[] = [
  { key: "W", label: "White", cls: "ms-w" },
  { key: "U", label: "Blue", cls: "ms-u" },
  { key: "B", label: "Black", cls: "ms-b" },
  { key: "R", label: "Red", cls: "ms-r" },
  { key: "G", label: "Green", cls: "ms-g" },
  { key: "C", label: "Colorless", cls: "ms-c" },
];

const BY_KEY = Object.fromEntries(COLOR_TOGGLES.map((c) => [c.key, c]));

export default function ColorToggle({
  color,
  on,
  onClick,
  disabled = false,
  title,
}: {
  /** W, U, B, R, G, or C. */
  color: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Defaults to the color's name. */
  title?: string;
}) {
  const c = BY_KEY[color];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? c.label}
      aria-label={c.label}
      aria-pressed={on}
      className={
        "rounded-full p-0.5 text-[18px] leading-none transition " +
        (on
          ? "ring-2 ring-emerald-400"
          : disabled
            ? "cursor-not-allowed opacity-20 grayscale"
            : "opacity-35 grayscale hover:opacity-70")
      }
    >
      <i className={`ms ${c.cls} ms-cost ms-shadow`} />
    </button>
  );
}
