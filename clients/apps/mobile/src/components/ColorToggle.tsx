import { TouchableOpacity } from "react-native";
import { ManaSymbol } from "./ManaSymbols";

// One mana-symbol toggle — the color filter button everywhere a color can be
// picked, matching the web's ColorToggle: lit with a ring when on, dimmed when off.

export const COLOR_TOGGLES: { key: string; label: string }[] = [
  { key: "W", label: "White" },
  { key: "U", label: "Blue" },
  { key: "B", label: "Black" },
  { key: "R", label: "Red" },
  { key: "G", label: "Green" },
  { key: "C", label: "Colorless" },
];

const LABELS = Object.fromEntries(COLOR_TOGGLES.map((c) => [c.key, c.label]));

export default function ColorToggle({
  color,
  on,
  onPress,
  disabled = false,
  size = 26,
}: {
  /** W, U, B, R, G, or C. */
  color: string;
  on: boolean;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={LABELS[color]}
      accessibilityState={{ selected: on, disabled }}
      hitSlop={4}
      activeOpacity={0.7}
      className={"rounded-full border-2 p-0.5 " + (on ? "border-emerald-400" : "border-transparent")}
      style={{ opacity: on ? 1 : disabled ? 0.2 : 0.4 }}
    >
      <ManaSymbol symbol={color} size={size} />
    </TouchableOpacity>
  );
}
