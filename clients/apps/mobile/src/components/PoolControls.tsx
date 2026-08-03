import { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Modal, FlatList, ActivityIndicator,
} from "react-native";
import type { CollectionSet, PoolScope } from "@mtg/shared";
import { api } from "../lib/api";

// Which cards a build may draw on, mirroring the web control: first "skip what's
// already sleeved up in another deck", then "and only from these sets". Both
// default to off, so an untouched build uses the whole collection.
//
// Set names come from the backend rather than Scryfall's /sets index — mobile has
// no equivalent of the web app's cached set catalog, so the API carries them.

export default function PoolControls({
  scope,
  onScopeChange,
  sets,
  onSetsChange,
  disabled,
}: {
  scope: PoolScope;
  onScopeChange: (next: PoolScope) => void;
  sets: string[];
  onSetsChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [available, setAvailable] = useState<CollectionSet[] | null>(null);
  const [filter, setFilter] = useState("");

  // Fetched when the sheet opens: availability counts shift every time a deck is
  // marked in use, so a value cached at mount would be wrong by the time it showed.
  useEffect(() => {
    if (!picking || available) return;
    api
      .listCollectionSets()
      .then(setAvailable)
      .catch(() => setAvailable([]));
  }, [picking, available]);

  useEffect(() => {
    setAvailable(null);
  }, [scope]);

  const selected = useMemo(() => new Set(sets), [sets]);

  const visible = useMemo(() => {
    const rows = available ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [available, filter]);

  function toggleSet(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onSetsChange([...next]);
  }

  const label =
    sets.length === 0
      ? "All sets"
      : sets.length === 1
        ? ((available ?? []).find((s) => s.code === sets[0])?.name ?? sets[0].toUpperCase())
        : `${sets.length} sets`;

  return (
    <View>
      <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
        Card pool
      </Text>

      <View className="flex-row rounded-lg border border-slate-700 p-0.5">
        <TouchableOpacity
          onPress={() => onScopeChange("owned")}
          disabled={disabled}
          className={"flex-1 rounded-md py-2 " + (scope === "owned" ? "bg-slate-800" : "")}
          activeOpacity={0.7}
        >
          <Text className={"text-center text-sm " + (scope === "owned" ? "text-white" : "text-slate-400")}>
            All owned
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onScopeChange("available")}
          disabled={disabled}
          className={"flex-1 rounded-md py-2 " + (scope === "available" ? "bg-slate-800" : "")}
          activeOpacity={0.7}
        >
          <Text className={"text-center text-sm " + (scope === "available" ? "text-white" : "text-slate-400")}>
            Available only
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={() => setPicking(true)}
        disabled={disabled}
        className={
          "mt-2 flex-row items-center justify-between rounded-lg border px-3 py-2.5 " +
          (sets.length > 0 ? "border-emerald-600 bg-emerald-600/20" : "border-slate-700")
        }
        activeOpacity={0.7}
      >
        <Text className={"text-sm " + (sets.length > 0 ? "text-emerald-300" : "text-slate-400")}>
          {label}
        </Text>
        <Text className="text-slate-500">▾</Text>
      </TouchableOpacity>

      <Text className="mt-2 text-xs text-slate-500">
        {scope === "available"
          ? "Skipping cards already in a deck marked “in use”."
          : "Drawing on your whole collection."}
        {sets.length > 0 && " Basic lands are always available regardless of set."}
      </Text>

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <View className="flex-1 bg-slate-950 px-4 pt-14">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-white">Pick sets</Text>
            <TouchableOpacity onPress={() => setPicking(false)} hitSlop={8} activeOpacity={0.6}>
              <Text className="text-base text-emerald-400">Done</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter sets…"
            placeholderTextColor="#64748b"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
          />

          {sets.length > 0 && (
            <TouchableOpacity onPress={() => onSetsChange([])} className="py-3" activeOpacity={0.6}>
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
              ListEmptyComponent={
                <Text className="mt-6 text-center text-sm text-slate-500">
                  {available.length === 0 ? "No sets in your collection." : "No matching sets."}
                </Text>
              }
              renderItem={({ item }) => {
                const isOn = selected.has(item.code);
                const count = scope === "available" ? item.available : item.owned;
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
                    <Text className="flex-1 text-sm text-slate-200" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="text-xs text-slate-500">{count}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}
