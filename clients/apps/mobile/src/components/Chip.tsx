import type { ReactNode } from "react";
import { Text, TouchableOpacity } from "react-native";

// A toggleable pill — the web's filter Chip.
export default function Chip({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      activeOpacity={0.7}
      className={
        "rounded-full border px-3 py-1.5 " +
        (active ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700")
      }
    >
      <Text className={"text-xs " + (active ? "text-emerald-300" : "text-slate-400")}>{children}</Text>
    </TouchableOpacity>
  );
}
