import { useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { BracketOut, CurveBucket } from "@mtg/shared";

// The small read-only pieces of the deck view: stat tiles, the mana curve and
// the bracket badge — the web's StatTile, ManaCurve and BracketBadge.

export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View className="flex-1 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <Text className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</Text>
      <Text className="mt-1 text-xl font-semibold text-slate-100">{value}</Text>
    </View>
  );
}

/** Nonland cards by mana value, as plain bars. */
export function ManaCurve({ curve }: { curve: CurveBucket[] }) {
  const max = Math.max(1, ...curve.map((b) => b.count));
  return (
    <View className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <Text className="text-xs font-medium uppercase tracking-wider text-slate-500">Mana curve (nonlands)</Text>
      <View className="mt-3 flex-row items-end gap-1.5" style={{ height: 120 }}>
        {curve.map((b) => (
          <View key={b.cmc} className="flex-1 items-center justify-end gap-1">
            <Text className="text-[11px] text-slate-400">{b.count}</Text>
            <View
              className="w-full rounded-t bg-emerald-500/80"
              style={{ height: (b.count / max) * 80, minHeight: b.count ? 2 : 0 }}
            />
            <Text className="text-[11px] text-slate-500">{b.cmc === 7 ? "7+" : b.cmc}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Low brackets cool (casual), high brackets warm (spicy).
const TONE: Record<number, { box: string; text: string }> = {
  1: { box: "border-slate-600 bg-slate-700/40", text: "text-slate-200" },
  2: { box: "border-emerald-700 bg-emerald-900/30", text: "text-emerald-300" },
  3: { box: "border-sky-700 bg-sky-900/30", text: "text-sky-300" },
  4: { box: "border-orange-700 bg-orange-900/30", text: "text-orange-300" },
  5: { box: "border-rose-700 bg-rose-900/30", text: "text-rose-300" },
};

/** The estimated bracket; tap for how it was estimated. */
export function BracketBadge({ bracket }: { bracket: BracketOut }) {
  const [open, setOpen] = useState(false);
  const tone = TONE[bracket.bracket] ?? TONE[2];
  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
        className={`flex-row self-start rounded-lg border px-2.5 py-1 ${tone.box}`}
      >
        <Text className={`text-xs font-semibold ${tone.text}`}>
          ⚖ Bracket {bracket.bracket} · {bracket.label} {open ? "▲" : "▾"}
        </Text>
      </TouchableOpacity>
      {open && (
        <View className="mt-2 rounded-lg border border-slate-800 bg-slate-900/90 p-3">
          <Text className="text-xs leading-4 text-slate-300">{bracket.explanation}</Text>
          {bracket.signals.map((s) => (
            <Text key={s.key} className="mt-1.5 text-xs leading-4 text-slate-400">
              <Text className="font-medium text-slate-200">
                {s.label} ({s.count}):
              </Text>{" "}
              {s.cards.join(", ")}
            </Text>
          ))}
          {bracket.caveat && (
            <Text className="mt-2 border-t border-slate-800 pt-2 text-[11px] italic text-slate-500">
              {bracket.caveat}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
