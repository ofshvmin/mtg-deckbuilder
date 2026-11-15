import { useEffect, useMemo, useState } from "react";
import {
  Modal, View, Text, TextInput, FlatList, ScrollView, TouchableOpacity, ActivityIndicator,
} from "react-native";
import { fetchPrintings, type CardSearchResult, type PrintOption } from "@mtg/shared";
import { api } from "../lib/api";
import { lookupSet, useScryfallSets } from "../lib/scryfallSets";
import Chip from "./Chip";
import SetSymbol from "./SetSymbol";

// Add one card by hand — the web's "Add card" panel. Search by name, pick the
// exact printing, then count, finish, condition and what you paid. The sheet
// stays open after adding so a stack of new cards goes in one after another.

const CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
const FINISH_LABEL: Record<string, string> = { nonfoil: "Nonfoil", foil: "Foil", etched: "Etched" };

export default function AddCardModal({
  visible,
  onAdded,
  onClose,
}: {
  visible: boolean;
  onAdded: () => void;
  onClose: () => void;
}) {
  const setIndex = useScryfallSets();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [card, setCard] = useState<CardSearchResult | null>(null);
  const [prints, setPrints] = useState<PrintOption[] | null>(null);
  const [printFilter, setPrintFilter] = useState("");
  const [print, setPrint] = useState<PrintOption | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState("nonfoil");
  const [condition, setCondition] = useState(CONDITIONS[0]);
  const [price, setPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);

  // Debounced name search, while no card is chosen.
  useEffect(() => {
    if (card) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api.searchCards(query.trim(), 15));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, card]);

  function choosePrint(p: PrintOption) {
    setPrint(p);
    const f = p.finishes.includes("nonfoil") ? "nonfoil" : p.finishes[0];
    setFinish(f);
    setPrice(priceFor(p, f));
  }

  function priceFor(p: PrintOption, f: string): string {
    const usd = f === "foil" ? p.priceUsdFoil : p.priceUsd;
    return usd != null ? String(usd) : "";
  }

  async function selectCard(c: CardSearchResult) {
    setCard(c);
    setResults([]);
    setPrints(null);
    setPrint(null);
    setPrintFilter("");
    setAddedMsg(null);
    setError(null);
    const p = await fetchPrintings(c.oracle_id);
    setPrints(p);
    if (p.length > 0) choosePrint(p[0]);
  }

  function backToSearch() {
    setCard(null);
    setPrints(null);
    setPrint(null);
    setQuantity(1);
    setError(null);
  }

  function close() {
    backToSearch();
    setQuery("");
    setAddedMsg(null);
    onClose();
  }

  const filteredPrints = useMemo(() => {
    if (!prints) return [];
    const f = printFilter.trim().toLowerCase();
    return f ? prints.filter((p) => p.setName.toLowerCase().includes(f) || p.set.includes(f)) : prints;
  }, [prints, printFilter]);

  async function add() {
    if (!card) return;
    setAdding(true);
    setError(null);
    try {
      await api.addCard({
        name: card.name,
        oracleId: card.oracle_id,
        count: quantity,
        edition: print?.set ?? null,
        collectorNumber: print?.collectorNumber ?? null,
        finish,
        condition,
        purchasePrice: price.trim() ? Number(price) : null,
        language: "en",
      });
      onAdded();
      setAddedMsg(`Added ${quantity}× ${card.name}${print ? ` (${print.set.toUpperCase()})` : ""}`);
      backToSearch();
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add card");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between border-b border-slate-800 px-4 py-3">
          {card ? (
            <TouchableOpacity onPress={backToSearch} hitSlop={8} activeOpacity={0.6}>
              <Text className="text-sm text-slate-400">‹ Search</Text>
            </TouchableOpacity>
          ) : (
            <View className="w-16" />
          )}
          <Text className="text-base font-semibold text-white">Add card</Text>
          <TouchableOpacity onPress={close} hitSlop={8} activeOpacity={0.6} className="w-16 items-end">
            <Text className="text-base text-emerald-400">Done</Text>
          </TouchableOpacity>
        </View>

        {!card ? (
          <View className="flex-1 px-4 pt-4">
            {addedMsg && <Text className="mb-3 text-sm text-emerald-400">✓ {addedMsg}</Text>}
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search card name…"
              placeholderTextColor="#64748b"
              autoFocus
              autoCorrect={false}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
            />
            {searching && <ActivityIndicator size="small" color="#64748b" className="mt-4" />}
            <FlatList
              className="mt-2"
              data={results}
              keyExtractor={(r) => r.oracle_id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => void selectCard(item)}
                  className="border-b border-slate-800/60 py-3"
                  activeOpacity={0.6}
                >
                  <Text className="text-sm text-slate-200">{item.name}</Text>
                  <Text className="text-xs text-slate-500" numberOfLines={1}>
                    {item.type_line}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        ) : (
          <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
            <Text className="text-lg font-semibold text-white">{card.name}</Text>

            <Text className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-slate-500">Printing</Text>
            {prints === null ? (
              <ActivityIndicator size="small" color="#64748b" />
            ) : prints.length === 0 ? (
              <Text className="text-sm text-slate-500">No printings found — the card is added without a set.</Text>
            ) : (
              <>
                {prints.length > 6 && (
                  <TextInput
                    value={printFilter}
                    onChangeText={setPrintFilter}
                    placeholder="Filter sets…"
                    placeholderTextColor="#64748b"
                    autoCorrect={false}
                    className="mb-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
                  />
                )}
                <View className="max-h-64 overflow-hidden rounded-lg border border-slate-800">
                  <ScrollView nestedScrollEnabled>
                    {filteredPrints.map((p) => {
                      const on = print === p;
                      return (
                        <TouchableOpacity
                          key={`${p.set}-${p.collectorNumber}`}
                          onPress={() => choosePrint(p)}
                          activeOpacity={0.6}
                          className={"flex-row items-center gap-3 px-3 py-2.5 " + (on ? "bg-emerald-600/15" : "")}
                        >
                          <SetSymbol iconUri={lookupSet(setIndex, p.set)?.iconSvgUri} code={p.set} size={18} />
                          <View className="flex-1">
                            <Text className={"text-sm " + (on ? "text-emerald-300" : "text-slate-200")} numberOfLines={1}>
                              {p.setName}
                            </Text>
                            <Text className="text-xs text-slate-500">
                              {p.set.toUpperCase()} #{p.collectorNumber} · {p.releasedAt.slice(0, 4)}
                            </Text>
                          </View>
                          <Text className="text-xs text-slate-400">
                            {p.priceUsd != null ? `$${p.priceUsd.toFixed(2)}` : ""}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </>
            )}

            <Text className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-slate-500">Quantity</Text>
            <View className="flex-row items-center gap-4">
              <TouchableOpacity
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                className="h-9 w-9 items-center justify-center rounded-full border border-slate-700"
                activeOpacity={0.6}
              >
                <Text className="text-lg text-slate-300">−</Text>
              </TouchableOpacity>
              <Text className="min-w-8 text-center text-lg font-semibold text-white">{quantity}</Text>
              <TouchableOpacity
                onPress={() => setQuantity((q) => Math.min(99, q + 1))}
                className="h-9 w-9 items-center justify-center rounded-full border border-slate-700"
                activeOpacity={0.6}
              >
                <Text className="text-lg text-slate-300">+</Text>
              </TouchableOpacity>
            </View>

            {print && print.finishes.length > 1 && (
              <>
                <Text className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-slate-500">Finish</Text>
                <View className="flex-row flex-wrap gap-2">
                  {print.finishes.map((f) => (
                    <Chip
                      key={f}
                      active={finish === f}
                      onPress={() => {
                        setFinish(f);
                        setPrice(priceFor(print, f));
                      }}
                    >
                      {FINISH_LABEL[f] ?? f}
                    </Chip>
                  ))}
                </View>
              </>
            )}

            <Text className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-slate-500">Condition</Text>
            <View className="flex-row flex-wrap gap-2">
              {CONDITIONS.map((c) => (
                <Chip key={c} active={condition === c} onPress={() => setCondition(c)}>
                  {c}
                </Chip>
              ))}
            </View>

            <Text className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-slate-500">
              Price paid (optional)
            </Text>
            <View className="flex-row items-center gap-2">
              <Text className="text-sm text-slate-400">$</Text>
              <TextInput
                value={price}
                onChangeText={setPrice}
                placeholder="0.00"
                placeholderTextColor="#64748b"
                keyboardType="decimal-pad"
                className="w-32 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
              />
            </View>

            {error && <Text className="mt-4 text-sm text-rose-400">{error}</Text>}

            <TouchableOpacity
              onPress={add}
              disabled={adding || prints === null}
              className="my-6 rounded-xl bg-emerald-700 py-3 disabled:opacity-50"
              activeOpacity={0.8}
            >
              {adding ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-center text-sm font-semibold text-white">
                  Add {quantity}× to collection
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
