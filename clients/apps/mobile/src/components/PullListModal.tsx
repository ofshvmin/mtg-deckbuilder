import { useEffect, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Share } from "react-native";
import { COMMONS, RARES, buildScavengerData, type GeneratedDeck, type ScavData } from "@mtg/shared";
import { loadSetIndex } from "../lib/scryfallSets";

// The pull list — where each card in the deck lives in your collection. The web
// prints it as a PDF checklist; here it's a checklist you tick off at the shelf,
// and Share sends it as plain text (Notes, Messages, a printer).

function toText(data: ScavData): string {
  const lines: string[] = [`${data.deckName} — pull list`, ""];
  if (data.rareSets.length) {
    lines.push(RARES.toUpperCase());
    for (const set of data.rareSets) {
      lines.push(`${set.name}`);
      for (const c of set.cards) lines.push(`  ☐ ${c.name}${c.tag ? ` (${c.tag})` : ""}`);
    }
    lines.push("");
  }
  if (data.commonSets.length) {
    lines.push(COMMONS.toUpperCase());
    for (const set of data.commonSets) {
      lines.push(`${set.name}`);
      for (const group of set.colors) {
        lines.push(`  ${group.color}`);
        for (const c of group.cards) lines.push(`    ☐ ${c.name}${c.tag ? ` (${c.tag})` : ""}`);
      }
    }
    lines.push("");
  }
  if (data.multiples.length) {
    lines.push("OWNED IN MORE THAN ONE SET");
    for (const m of data.multiples) lines.push(`  ${m.name}: ${m.sets.join(", ")}`);
  }
  return lines.join("\n").trim() + "\n";
}

function Check({ on }: { on: boolean }) {
  return (
    <View
      className={
        "h-4 w-4 items-center justify-center rounded border " +
        (on ? "border-emerald-500 bg-emerald-600" : "border-slate-600")
      }
    >
      {on && <Text className="text-[10px] text-white">✓</Text>}
    </View>
  );
}

export default function PullListModal({
  deck,
  deckName,
  onClose,
}: {
  deck: GeneratedDeck;
  deckName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ScavData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    loadSetIndex()
      .then((sets) => buildScavengerData(deck, deckName, sets))
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't build the pull list."));
    return () => {
      cancelled = true;
    };
  }, [deck, deckName]);

  function toggle(key: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const row = (key: string, name: string, tag: string, indent = false) => (
    <TouchableOpacity
      key={key}
      onPress={() => toggle(key)}
      activeOpacity={0.6}
      className={"flex-row items-center gap-2.5 py-1.5 " + (indent ? "pl-3" : "")}
    >
      <Check on={done.has(key)} />
      <Text className={"flex-1 text-sm " + (done.has(key) ? "text-slate-600 line-through" : "text-slate-200")}>
        {name}
      </Text>
      {tag ? <Text className="text-xs text-slate-500">{tag}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between border-b border-slate-800 px-4 py-3">
          <TouchableOpacity
            onPress={() => data && void Share.share({ message: toText(data) })}
            disabled={!data}
            hitSlop={8}
            activeOpacity={0.6}
          >
            <Text className={"text-sm " + (data ? "text-emerald-400" : "text-slate-600")}>Share</Text>
          </TouchableOpacity>
          <Text className="text-base font-semibold text-white">Pull list</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} activeOpacity={0.6}>
            <Text className="text-base text-emerald-400">Done</Text>
          </TouchableOpacity>
        </View>

        {!data && !error && (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color="#64748b" />
            <Text className="mt-2 text-xs text-slate-500">Looking up rarities and sets…</Text>
          </View>
        )}
        {error && <Text className="p-4 text-sm text-rose-400">{error}</Text>}

        {data && (
          <ScrollView className="flex-1 px-4" contentContainerClassName="pb-10">
            <Text className="mt-3 text-xs leading-4 text-slate-500">
              Where each card is in your collection, grouped by set. Tick cards off as you pull them.
            </Text>

            {data.rareSets.length > 0 && (
              <>
                <Text className="mt-5 text-xs font-medium uppercase tracking-wider text-amber-300">{RARES}</Text>
                {data.rareSets.map((set) => (
                  <View key={set.code} className="mt-3">
                    <Text className="text-sm font-semibold text-slate-100">{set.name}</Text>
                    {set.cards.map((c) => row(`r:${set.code}:${c.name}`, c.name, c.tag))}
                  </View>
                ))}
              </>
            )}

            {data.commonSets.length > 0 && (
              <>
                <Text className="mt-6 text-xs font-medium uppercase tracking-wider text-sky-300">{COMMONS}</Text>
                {data.commonSets.map((set) => (
                  <View key={set.code} className="mt-3">
                    <Text className="text-sm font-semibold text-slate-100">{set.name}</Text>
                    {set.colors.map((group) => (
                      <View key={group.color} className="mt-1">
                        <Text className="text-xs uppercase tracking-wider text-slate-500">{group.color}</Text>
                        {group.cards.map((c) => row(`c:${set.code}:${group.color}:${c.name}`, c.name, c.tag, true))}
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )}

            {data.multiples.length > 0 && (
              <View className="mt-6 rounded-lg border border-slate-800 p-3">
                <Text className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Owned in more than one set
                </Text>
                {data.multiples.map((m) => (
                  <Text key={m.name} className="mt-1.5 text-xs leading-4 text-slate-400">
                    <Text className="text-slate-200">{m.name}</Text>: {m.sets.join(", ")}
                  </Text>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
