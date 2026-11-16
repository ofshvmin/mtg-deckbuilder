import { View, Text, TextInput, TouchableOpacity, ScrollView } from "react-native";
import type { CommanderFilters } from "@mtg/shared";
import { api } from "../lib/api";
import ColorToggle, { COLOR_TOGGLES } from "./ColorToggle";
import SetPicker, { type SetOption } from "./SetPicker";

// Narrowing for the commander search, mirroring the web picker: exact color
// identity, max mana value, creature type, sets owned in. Any filter on its own
// is enough to browse, so a name is no longer required to find a commander.

// Only sets you own a commander from, counted in commanders rather than cards.
async function loadCommanderSets(): Promise<SetOption[]> {
  const rows = await api.listCommanderSets();
  return rows.map((s) => ({ code: s.code, name: s.name, count: s.commanders }));
}

const MANA_VALUES = [1, 2, 3, 4, 5, 6];

export function hasCommanderFilters(f: CommanderFilters): boolean {
  return (
    (f.colors?.length ?? 0) > 0 || f.max_mv != null || !!f.creature_type?.trim() || (f.sets?.length ?? 0) > 0
  );
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
    const next = COLOR_TOGGLES.map((c) => c.key).filter((c) =>
      c === key ? !colors.includes(c) : colors.includes(c),
    );
    onChange({ ...filters, colors: next });
  }

  const chip = (active: boolean) =>
    "rounded-full border px-3 py-1 " + (active ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700");

  return (
    <View className="mt-3 gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="w-24 text-xs font-medium uppercase tracking-wider text-slate-400">Colors</Text>
        <View className="flex-row gap-1">
          {COLOR_TOGGLES.map((c) => (
            <ColorToggle
              key={c.key}
              color={c.key}
              on={colors.includes(c.key)}
              onPress={() => toggleColor(c.key)}
            />
          ))}
        </View>
      </View>

      <View className="flex-row items-center">
        <Text className="w-24 text-xs font-medium uppercase tracking-wider text-slate-400">Mana value</Text>
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
        <Text className="w-24 text-xs font-medium uppercase tracking-wider text-slate-400">Sets</Text>
        <View className="flex-1">
          <SetPicker
            sets={filters.sets ?? []}
            onChange={(sets) => onChange({ ...filters, sets })}
            loadSets={loadCommanderSets}
            emptyText="No commanders in your collection."
          />
        </View>
      </View>

      <View className="flex-row items-center">
        <Text className="w-24 text-xs font-medium uppercase tracking-wider text-slate-400">Type</Text>
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
