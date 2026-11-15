import type { Color, ColorRationale } from "@mtg/shared";
import ColorPips from "./ColorPips";
import ColorToggle, { COLOR_TOGGLES } from "./ColorToggle";

const COLORS = COLOR_TOGGLES.filter((c) => c.key !== "C");

/**
 * Colors as a generation knob.
 *
 * Nothing selected means full auto — the generator searches every legal color
 * combination. Selecting colors locks them; the "auto-fill" checkbox decides whether
 * the generator may add more around that lock, so "exactly these colors" stays
 * reachable.
 *
 * Alternates get equal billing rather than hiding behind a disclosure: on an evenly
 * distributed collection the top combinations score within a hair of each other, which
 * makes the runner-ups the useful control rather than trivia.
 */
export default function ColorPicker({
  colors,
  onChange,
  autoFill,
  onAutoFillChange,
  maxColors,
  rationale,
  onPickAlternate,
  busy = false,
}: {
  colors: string[];
  onChange: (next: string[]) => void;
  autoFill: boolean;
  onAutoFillChange: (next: boolean) => void;
  maxColors: number;
  rationale?: ColorRationale | null;
  onPickAlternate?: (colors: string[]) => void;
  /** Rebuilding — toggles apply immediately, so show it rather than freezing. */
  busy?: boolean;
}) {
  const atLimit = colors.length >= maxColors;
  const pips = <ColorPips colors={colors as Color[]} />;

  function toggle(key: string) {
    if (colors.includes(key)) {
      onChange(colors.filter((c) => c !== key));
    } else if (!atLimit) {
      onChange([...COLORS.map((c) => c.key)].filter((c) => colors.includes(c) || c === key));
    }
  }

  return (
    <div className={"space-y-2 transition " + (busy ? "opacity-60" : "")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Colors</label>
        <div className="flex gap-1">
          {COLORS.map((c) => {
            const on = colors.includes(c.key);
            const disabled = !on && atLimit;
            return (
              <ColorToggle
                key={c.key}
                color={c.key}
                on={on}
                onClick={() => toggle(c.key)}
                disabled={disabled || busy}
                title={disabled ? `Up to ${maxColors} colors` : undefined}
              />
            );
          })}
        </div>

        <label
          className={
            "flex items-center gap-2 text-xs " +
            (colors.length ? "text-slate-300" : "text-slate-600")
          }
          title={
            colors.length
              ? "Let the generator add colors around the ones you picked"
              : "Only matters once you pick a color"
          }
        >
          <input
            type="checkbox"
            checked={autoFill}
            onChange={(e) => onAutoFillChange(e.target.checked)}
            disabled={!colors.length}
            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800"
          />
          auto-fill remaining
        </label>
      </div>

      <p className="text-xs text-slate-500">
        {colors.length === 0
          ? "Nothing selected — the generator picks the colors your collection supports best."
          : autoFill
            ? <>Building around {pips}, adding colors if they improve the deck.</>
            : <>Building exactly {pips}.</>}
      </p>

      {rationale && rationale.alternates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-slate-500">Also considered:</span>
          {rationale.alternates.map((alt) => (
            <button
              key={alt.colors.join("")}
              onClick={() => onPickAlternate?.(alt.colors)}
              disabled={busy}
              title={`Score ${alt.score.toFixed(3)} — click to rebuild in these colors`}
              className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              <ColorPips colors={alt.colors} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
