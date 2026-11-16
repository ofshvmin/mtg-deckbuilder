import { View, Text, TouchableOpacity } from "react-native";
import type { Color, ColorRationale } from "@mtg/shared";
import ColorToggle, { COLOR_TOGGLES } from "./ColorToggle";
import { ColorPips } from "./ManaSymbols";

// Colors as a generation knob for formats without a commander — the web's
// ColorPicker. Nothing selected means full auto: the generator searches every
// legal color combination. Selecting colors locks them; "auto-fill" decides
// whether the generator may add more around the lock, so "exactly these colors"
// stays reachable. Alternates get equal billing: on an evenly spread collection
// the top combinations score within a hair of each other.

const COLORS = COLOR_TOGGLES.filter((c) => c.key !== "C");

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

  function toggle(key: string) {
    if (colors.includes(key)) onChange(colors.filter((c) => c !== key));
    else if (!atLimit) onChange(COLORS.map((c) => c.key).filter((c) => colors.includes(c) || c === key));
  }

  return (
    <View className="gap-2" style={{ opacity: busy ? 0.6 : 1 }}>
      <Text className="text-xs font-medium uppercase tracking-wider text-slate-400">Colors</Text>
      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-2">
        <View className="flex-row gap-1">
          {COLORS.map((c) => {
            const on = colors.includes(c.key);
            return (
              <ColorToggle
                key={c.key}
                color={c.key}
                on={on}
                onPress={() => toggle(c.key)}
                disabled={(!on && atLimit) || busy}
              />
            );
          })}
        </View>
        <TouchableOpacity
          onPress={() => onAutoFillChange(!autoFill)}
          disabled={!colors.length || busy}
          activeOpacity={0.7}
          className="flex-row items-center gap-2"
        >
          <View
            className={
              "h-4 w-4 items-center justify-center rounded border " +
              (autoFill && colors.length ? "border-emerald-500 bg-emerald-600" : "border-slate-600")
            }
          >
            {autoFill && colors.length > 0 && <Text className="text-[10px] text-white">✓</Text>}
          </View>
          <Text className={"text-xs " + (colors.length ? "text-slate-300" : "text-slate-600")}>
            auto-fill remaining
          </Text>
        </TouchableOpacity>
      </View>

      <View className="flex-row flex-wrap items-center gap-1">
        {colors.length === 0 ? (
          <Text className="text-xs text-slate-500">
            Nothing selected — the generator picks the colors your collection supports best.
          </Text>
        ) : (
          <>
            <Text className="text-xs text-slate-500">{autoFill ? "Building around" : "Building exactly"}</Text>
            <ColorPips colors={colors as Color[]} size={13} />
            {autoFill && <Text className="text-xs text-slate-500">, adding colors if they improve the deck.</Text>}
          </>
        )}
      </View>
      {atLimit && <Text className="text-xs text-slate-600">Up to {maxColors} colors.</Text>}

      {rationale && rationale.alternates.length > 0 && (
        <View className="flex-row flex-wrap items-center gap-2 pt-1">
          <Text className="text-xs text-slate-500">Also considered:</Text>
          {rationale.alternates.map((alt) => (
            <TouchableOpacity
              key={alt.colors.join("")}
              onPress={() => onPickAlternate?.(alt.colors)}
              disabled={busy}
              activeOpacity={0.7}
              className="rounded-full border border-slate-700 px-2.5 py-1"
            >
              <ColorPips colors={alt.colors} size={13} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
