import type { ReactNode } from "react";
import { Modal, View, Text, TextInput, ScrollView, TouchableOpacity } from "react-native";
import {
  CARD_TYPES,
  COLOR_ORDER,
  EMPTY_FILTERS,
  RARITIES,
  type Color,
  type ColorMode,
  type FilterState,
} from "@mtg/shared";
import Chip from "./Chip";
import ColorToggle from "./ColorToggle";
import SetPicker from "./SetPicker";

// Every collection filter the web offers, in one sheet. Changes apply as they're
// made — the count on the Done button is the live result — so there's no
// separate "apply" step to forget.

export const MODE_LABELS: Record<ColorMode, string> = {
  any: "Any of",
  exact: "Exactly",
  atMost: "At most",
};

const MODE_HINTS: Record<ColorMode, string> = {
  any: "Cards including at least one of the selected colors",
  exact: "Cards whose colors are exactly the selection",
  atMost: "Cards that fit inside the selection — what's legal in that deck",
};

function Section({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View className="border-b border-slate-800/60 py-4">
      <Text className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</Text>
      {hint && <Text className="mt-1 text-xs leading-4 text-slate-600">{hint}</Text>}
      <View className="mt-2.5 flex-row flex-wrap items-center gap-2">{children}</View>
    </View>
  );
}

function toggleIn<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function numOrNull(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function CollectionFilterSheet({
  visible,
  filters,
  onChange,
  resultCount,
  onClose,
}: {
  visible: boolean;
  filters: FilterState;
  onChange: (next: FilterState) => void;
  /** Cards passing the filters right now, for the Done button. */
  resultCount: number;
  onClose: () => void;
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between border-b border-slate-800 px-4 py-3">
          <TouchableOpacity onPress={() => onChange(EMPTY_FILTERS)} hitSlop={8} activeOpacity={0.6}>
            <Text className="text-sm text-slate-400">Clear all</Text>
          </TouchableOpacity>
          <Text className="text-base font-semibold text-white">Filters</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} activeOpacity={0.6}>
            <Text className="text-base text-emerald-400">Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-4" keyboardShouldPersistTaps="handled">
          <Section label="Sets">
            <View className="flex-1">
              <SetPicker
                sets={filters.sets}
                onChange={(sets) => set({ sets })}
                countKey={filters.availability === "available" ? "available" : "owned"}
              />
            </View>
          </Section>

          <Section label="Colors" hint={MODE_HINTS[filters.colorMode]}>
            {COLOR_ORDER.map((c) => (
              <ColorToggle
                key={c}
                color={c}
                on={filters.colors.includes(c)}
                onPress={() => set({ colors: toggleIn<Color>(filters.colors, c) })}
              />
            ))}
            <ColorToggle color="C" on={filters.colorless} onPress={() => set({ colorless: !filters.colorless })} />
          </Section>
          <View className="-mt-2 flex-row gap-2 pb-4">
            {(Object.keys(MODE_LABELS) as ColorMode[]).map((m) => (
              <Chip key={m} active={filters.colorMode === m} onPress={() => set({ colorMode: m })}>
                {MODE_LABELS[m]}
              </Chip>
            ))}
          </View>

          <Section label="Type">
            {CARD_TYPES.map((t) => (
              <Chip key={t} active={filters.types.includes(t)} onPress={() => set({ types: toggleIn(filters.types, t) })}>
                {t}
              </Chip>
            ))}
          </Section>

          <Section
            label="Rarity"
            hint="Rarity comes from the card's representative printing, so a card reprinted at another rarity reads as one value."
          >
            {RARITIES.map((r) => (
              <Chip
                key={r}
                active={filters.rarities.includes(r)}
                onPress={() => set({ rarities: toggleIn(filters.rarities, r) })}
              >
                {r}
              </Chip>
            ))}
          </Section>

          <Section label="Mana value">
            <TextInput
              value={filters.cmcMin != null ? String(filters.cmcMin) : ""}
              onChangeText={(t) => set({ cmcMin: numOrNull(t) })}
              placeholder="min"
              placeholderTextColor="#64748b"
              keyboardType="number-pad"
              className="w-20 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
            />
            <Text className="text-slate-600">–</Text>
            <TextInput
              value={filters.cmcMax != null ? String(filters.cmcMax) : ""}
              onChangeText={(t) => set({ cmcMax: numOrNull(t) })}
              placeholder="max"
              placeholderTextColor="#64748b"
              keyboardType="number-pad"
              className="w-20 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
            />
          </Section>

          <Section label="Availability">
            <Chip active={filters.availability === "owned"} onPress={() => set({ availability: "owned" })}>
              All owned
            </Chip>
            <Chip active={filters.availability === "available"} onPress={() => set({ availability: "available" })}>
              Available only
            </Chip>
          </Section>

          <Section label="Finish">
            {(["any", "nonfoil", "foil"] as const).map((f) => (
              <Chip key={f} active={filters.finish === f} onPress={() => set({ finish: f })}>
                {f === "any" ? "Either" : f}
              </Chip>
            ))}
          </Section>

          <Section label="Copies owned">
            {[2, 4].map((n) => (
              <Chip
                key={n}
                active={filters.minCopies === n}
                onPress={() => set({ minCopies: filters.minCopies === n ? null : n })}
              >
                {n === 4 ? "4+ (playsets)" : "2+"}
              </Chip>
            ))}
          </Section>

          <Section label="Lists">
            <Chip active={filters.reservedOnly} onPress={() => set({ reservedOnly: !filters.reservedOnly })}>
              Reserved List
            </Chip>
            <Chip active={filters.gameChangersOnly} onPress={() => set({ gameChangersOnly: !filters.gameChangersOnly })}>
              Game Changers
            </Chip>
          </Section>

          <Section label="Colors read from">
            <Chip active={filters.colorSource === "identity"} onPress={() => set({ colorSource: "identity" })}>
              Identity
            </Chip>
            <Chip active={filters.colorSource === "colors"} onPress={() => set({ colorSource: "colors" })}>
              Card colors
            </Chip>
          </Section>

          <TouchableOpacity onPress={onClose} className="my-6 rounded-xl bg-emerald-700 py-3" activeOpacity={0.8}>
            <Text className="text-center text-sm font-semibold text-white">
              Show {resultCount.toLocaleString()} card{resultCount === 1 ? "" : "s"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}
