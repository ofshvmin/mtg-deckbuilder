import { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import type { PoolCard } from "@mtg/shared";
import { ColorPips, ManaCost } from "./ManaSymbols";

// The legal pool as a searchable list — the web's PoolTable for a phone. It
// renders inside the build screen's scroll view, so rows come in pages rather
// than a virtualised list nested in another scroller.

const PAGE = 100;

function shortType(typeLine: string): string {
  return typeLine.split("—")[0].trim();
}

export default function LegalPoolList({
  pool,
  onOpenCard,
}: {
  pool: PoolCard[];
  onOpenCard: (card: PoolCard) => void;
}) {
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? pool.filter((c) => c.name.toLowerCase().includes(f)) : pool;
  }, [pool, filter]);
  const shown = filtered.slice(0, limit);

  return (
    <View className="rounded-xl border border-slate-800 bg-slate-900/60">
      <View className="flex-row items-center justify-between gap-3 border-b border-slate-800 p-3">
        <Text className="text-xs font-medium uppercase tracking-wider text-slate-500">Legal pool</Text>
        <TextInput
          value={filter}
          onChangeText={(t) => {
            setFilter(t);
            setLimit(PAGE);
          }}
          placeholder="Filter by name…"
          placeholderTextColor="#64748b"
          autoCorrect={false}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        />
      </View>
      {shown.map((c) => (
        <TouchableOpacity
          key={c.oracle_id}
          onPress={() => onOpenCard(c)}
          activeOpacity={0.6}
          className="flex-row items-center gap-2 border-b border-slate-800/60 px-3 py-2"
        >
          <View className="flex-1">
            <Text className="text-sm text-slate-200" numberOfLines={1}>
              {c.name}
            </Text>
            <Text className="text-xs text-slate-500" numberOfLines={1}>
              {shortType(c.type_line)} · MV {c.cmc}
            </Text>
          </View>
          <ManaCost cost={c.mana_cost} size={12} />
          <ColorPips colors={c.color_identity} size={12} />
          <Text className="w-7 text-right text-xs text-slate-400">×{c.copies_owned}</Text>
        </TouchableOpacity>
      ))}
      <View className="flex-row items-center justify-between px-3 py-2">
        <Text className="text-xs text-slate-500">
          Showing {shown.length.toLocaleString()} of {filtered.length.toLocaleString()}
        </Text>
        {filtered.length > shown.length && (
          <Text onPress={() => setLimit((l) => l + PAGE)} className="text-xs text-emerald-400">
            Show more
          </Text>
        )}
      </View>
    </View>
  );
}
