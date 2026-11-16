import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, ActivityIndicator } from "react-native";
import { api } from "../lib/api";
import { lookupSet, useScryfallSets } from "../lib/scryfallSets";
import SetSymbol from "./SetSymbol";

// A multi-select over sets — the web's SetPicker as a button plus a full-screen
// sheet. Rows are fetched when the sheet opens: counts shift every time a deck is
// marked in use, so a list cached at mount would be stale by the time it showed.
//
// By default the rows are the collection's sets with copy counts. The commander
// picker passes its own `loadSets` — only sets holding an eligible commander,
// counted in commanders.

/** One row in the picker: a set and the number shown beside it. */
export interface SetOption {
  code: string;
  name: string;
  count: number;
}

export default function SetPicker({
  sets,
  onChange,
  countKey = "owned",
  loadSets,
  emptyText = "No sets in your collection.",
  disabled,
}: {
  /** Selected set codes, lowercase. */
  sets: string[];
  onChange: (next: string[]) => void;
  /** Which number to show per set — copies owned, or copies still free. */
  countKey?: "owned" | "available";
  /** Replaces the collection's set list (and `countKey`) with another source. */
  loadSets?: () => Promise<SetOption[]>;
  /** Shown when the source has no sets at all. */
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<SetOption[] | null>(null);
  const [filter, setFilter] = useState("");
  const setIndex = useScryfallSets();

  useEffect(() => {
    if (!open || available) return;
    const load =
      loadSets ??
      (async () =>
        (await api.listCollectionSets()).map((s) => ({
          code: s.code,
          name: s.name,
          count: countKey === "available" ? s.available : s.owned,
        })));
    load().then(setAvailable).catch(() => setAvailable([]));
  }, [open, available, loadSets, countKey]);

  useEffect(() => {
    setAvailable(null);
  }, [countKey]);

  const selected = useMemo(() => new Set(sets), [sets]);

  const visible = useMemo(() => {
    const rows = available ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }, [available, filter]);

  function toggleSet(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange([...next]);
  }

  function setName(code: string): string {
    return (
      lookupSet(setIndex, code)?.name ??
      (available ?? []).find((s) => s.code === code)?.name ??
      code.toUpperCase()
    );
  }

  const label = sets.length === 0 ? "All sets" : sets.length === 1 ? setName(sets[0]) : `${sets.length} sets`;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        disabled={disabled}
        className={
          "flex-row items-center justify-between rounded-lg border px-3 py-2.5 " +
          (sets.length > 0 ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700")
        }
        activeOpacity={0.7}
      >
        <Text
          className={"flex-1 text-sm " + (sets.length > 0 ? "text-emerald-300" : "text-slate-400")}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text className="pl-2 text-slate-500">▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-slate-950 px-4 pt-14">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-white">Pick sets</Text>
            <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8} activeOpacity={0.6}>
              <Text className="text-base text-emerald-400">Done</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter sets…"
            placeholderTextColor="#64748b"
            autoCorrect={false}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
          />

          {sets.length > 0 && (
            <TouchableOpacity onPress={() => onChange([])} className="py-3" activeOpacity={0.6}>
              <Text className="text-sm text-slate-400">✕ Clear ({sets.length} selected)</Text>
            </TouchableOpacity>
          )}

          {available === null ? (
            <ActivityIndicator size="small" color="#64748b" className="mt-6" />
          ) : (
            <FlatList
              className="mt-2"
              data={visible}
              keyExtractor={(s) => s.code}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text className="mt-6 text-center text-sm text-slate-500">
                  {available.length === 0 ? emptyText : "No matching sets."}
                </Text>
              }
              renderItem={({ item }) => {
                const isOn = selected.has(item.code);
                const info = lookupSet(setIndex, item.code);
                return (
                  <TouchableOpacity
                    onPress={() => toggleSet(item.code)}
                    className="flex-row items-center gap-3 border-b border-slate-800/60 py-3"
                    activeOpacity={0.6}
                  >
                    <View
                      className={
                        "h-5 w-5 items-center justify-center rounded border " +
                        (isOn ? "border-emerald-500 bg-emerald-600" : "border-slate-600")
                      }
                    >
                      {isOn && <Text className="text-xs text-white">✓</Text>}
                    </View>
                    <SetSymbol iconUri={info?.iconSvgUri} code={item.code} size={18} />
                    <Text className="flex-1 text-sm text-slate-200" numberOfLines={1}>
                      {info?.name ?? item.name}
                    </Text>
                    <Text className={"text-xs " + (item.count > 0 ? "text-slate-500" : "text-slate-600")}>
                      {item.count}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </>
  );
}
