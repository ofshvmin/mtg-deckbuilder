import { View, Text, TextInput, TouchableOpacity, ScrollView } from "react-native";
import type { CommanderFilters } from "@mtg/shared";

// Narrowing for the commander search, mirroring the web picker: exact color
// identity, max mana value, creature type. Any filter on its own is enough to
// browse, so a name is no longer required to find a commander.

const COLORS: { key: string; label: string; on: string }[] = [
  { key: "W", label: "White", on: "bg-amber-100 border-amber-300" },
  { key: "U", label: "Blue", on: "bg-sky-400 border-sky-300" },
  { key: "B", label: "Black", on: "bg-slate-500 border-slate-300" },
  { key: "R", label: "Red", on: "bg-rose-500 border-rose-300" },
  { key: "G", label: "Green", on: "bg-emerald-500 border-emerald-300" },
  { key: "C", label: "Colorless", on: "bg-stone-300 border-stone-200" },
];

const MANA_VALUES = [1, 2, 3, 4, 5, 6];

export function hasCommanderFilters(f: CommanderFilters): boolean {
  return (f.colors?.length ?? 0) > 0 || f.max_mv != null || !!f.creature_type?.trim();
}

export default function CommanderFilterBar({
  filters,
  onChange,
}: {
  filters: CommanderFilters;
  onChange: (next: CommanderFilters) => void;
}) {
  const colors = filters.colors ?? [];

  // C combines with colors — it asks for a {C} pip in the cost (Ulalek is WUBRG + C).
  function toggleColor(key: string) {
    const next = COLORS.map((c) => c.key).filter((c) =>
      c === key ? !colors.includes(c) : colors.includes(c),
    );
    onChange({ ...filters, colors: next });
  }

  const chip = (active: boolean) =>
    "rounded-full border px-3 py-1 " + (active ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700");

  return (
    <View className="mt-3 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="w-20 text-xs font-medium uppercase tracking-wider text-slate-400">Colors</Text>
        {COLORS.map((c) => {
          const on = colors.includes(c.key);
          return (
            <TouchableOpacity
              key={c.key}
              onPress={() => toggleColor(c.key)}
              accessibilityLabel={c.label}
              accessibilityState={{ selected: on }}
              hitSlop={4}
              activeOpacity={0.7}
              className={
                "h-8 w-8 items-center justify-center rounded-full border-2 " +
                (on ? c.on : "border-slate-700 bg-slate-800")
              }
            >
              <Text className={"text-sm font-semibold " + (on ? "text-slate-900" : "text-slate-500")}>
                {c.key}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View className="flex-row items-center">
        <Text className="w-20 text-xs font-medium uppercase tracking-wider text-slate-400">Mana value</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <TouchableOpacity
            onPress={() => onChange({ ...filters, max_mv: null })}
            className={chip(filters.max_mv == null)}
            activeOpacity={0.7}
          >
            <Text className="text-xs text-slate-200">Any</Text>
          </TouchableOpacity>
          {MANA_VALUES.map((mv) => (
            <TouchableOpacity
              key={mv}
              onPress={() => onChange({ ...filters, max_mv: mv })}
              className={chip(filters.max_mv === mv)}
              activeOpacity={0.7}
            >
              <Text className="text-xs text-slate-200">≤ {mv}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View className="flex-row items-center">
        <Text className="w-20 text-xs font-medium uppercase tracking-wider text-slate-400">Type</Text>
        <TextInput
          value={filters.creature_type ?? ""}
          onChangeText={(t) => onChange({ ...filters, creature_type: t })}
          placeholder="Creature type, e.g. Elf"
          placeholderTextColor="#64748b"
          autoCapitalize="words"
          autoCorrect={false}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
        />
        {hasCommanderFilters(filters) && (
          <TouchableOpacity onPress={() => onChange({})} hitSlop={8} className="pl-3" activeOpacity={0.6}>
            <Text className="text-xs text-slate-400 underline">Clear</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
