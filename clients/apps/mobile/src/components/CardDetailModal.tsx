import { useEffect, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, Dimensions, Alert, ActivityIndicator } from "react-native";
import {
  cheapestPrint,
  fetchCardDetail,
  type CardDetail,
  type CollectionCard,
  type Color,
  type Printing,
} from "@mtg/shared";
import { api } from "../lib/api";
import { lookupSet, useScryfallSets } from "../lib/scryfallSets";
import CardImage from "./CardImage";
import { ColorPips, ManaCost } from "./ManaSymbols";
import SetSymbol from "./SetSymbol";

// One card, the web's detail view laid out for a phone: the set banner for the
// copy in focus, chips to flip between owned printings, then the market price
// and what you own of it. Opened from the collection it can remove the card;
// opened from a deck, a separate list earmarks which physical copy the deck uses.

const SCREEN_WIDTH = Dimensions.get("window").width;

// Cards opened without ownership data (a deck's commander, a combo piece) are
// looked up in the collection, as the web's sheet does. One fetch serves every
// sheet opened in the next minute.
let collectionCache: { at: number; cards: Promise<CollectionCard[]> } | null = null;

function ownedCopy(oracleId?: string, name?: string): Promise<CollectionCard | undefined> {
  if (!collectionCache || Date.now() - collectionCache.at > 60_000) {
    collectionCache = { at: Date.now(), cards: api.listCollectionCards().catch(() => []) };
  }
  return collectionCache.cards.then((cards) =>
    cards.find((c) => (oracleId && c.oracle_id === oracleId) || c.name === name),
  );
}
const CARD_WIDTH = SCREEN_WIDTH * 0.75;

interface Props {
  card: {
    oracle_id?: string;
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    color_identity?: Color[];
    total_count?: number;
    printings?: Printing[];
    /** When shown from a deck: which owned copy that deck currently holds. */
    selected_printing_key?: string | null;
  } | null;
  /** When set, tapping a printing reassigns which copy the deck holds. */
  onSelectPrinting?: (printingKey: string) => void;
  /** When set, offers "Remove from collection" and calls this after it succeeds. */
  onRemoved?: () => void;
  onClose: () => void;
}

function Row({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  return (
    <View className="flex-row items-center justify-between border-b border-slate-800/60 px-4 py-2.5">
      <Text className="text-sm text-slate-400">{label}</Text>
      <Text className={accent ? "text-base font-semibold text-emerald-300" : "text-sm text-slate-200"}>
        {value ?? "—"}
      </Text>
    </View>
  );
}

export default function CardDetailModal({ card, onSelectPrinting, onRemoved, onClose }: Props) {
  const setIndex = useScryfallSets();
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [index, setIndexState] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [ownedCard, setOwnedCard] = useState<CollectionCard | null>(null);

  // Open on the copy the deck holds, not just the first one owned.
  useEffect(() => {
    if (!card) return;
    const i = card.printings?.findIndex((p) => p.printing_key === card.selected_printing_key) ?? -1;
    setIndexState(i >= 0 ? i : 0);
    setDetail(null);
    setOwnedCard(null);
    let cancelled = false;
    if (!card.printings?.length) {
      ownedCopy(card.oracle_id, card.name).then((c) => !cancelled && c && setOwnedCard(c));
    }
    // Scryfall market data, for unowned cards and owned printings the DB has no price for.
    fetchCardDetail({ oracleId: card.oracle_id, name: card.name }).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [card?.oracle_id, card?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!card) return null;

  const owned = card.printings?.length ? card.printings : (ownedCard?.printings ?? []);
  const totalCount = card.total_count ?? ownedCard?.total_count;
  const isOwned = owned.length > 0;
  const cheapest = detail ? cheapestPrint(detail.prints) : undefined;
  const current: Printing | undefined = isOwned
    ? owned[Math.min(index, owned.length - 1)]
    : cheapest
      ? {
          printing_key: `market:${cheapest.set}:${cheapest.collectorNumber}`,
          edition: cheapest.set,
          collector_number: cheapest.collectorNumber,
          finish: "nonfoil",
          condition: null,
          language: null,
          count: 0,
        }
      : undefined;

  // Prefer the price the backend attached to the printing (no live call); fall
  // back to Scryfall's for the same set and number.
  const foil = current?.finish === "foil";
  const fromDb = foil ? (current?.price_usd_foil ?? current?.price_usd) : current?.price_usd;
  const match = detail?.prints.find(
    (p) => p.set === current?.edition?.toLowerCase() && p.collectorNumber === current?.collector_number,
  );
  const fromScryfall = foil ? (match?.priceUsdFoil ?? match?.priceUsd) : match?.priceUsd;
  const marketUsd = fromDb ?? fromScryfall ?? null;

  const typeLine = card.type_line || detail?.typeLine;
  const manaCost = card.mana_cost || detail?.manaCost;
  const oracleText = card.oracle_text || detail?.oracleText;
  const setInfo = lookupSet(setIndex, current?.edition);

  function confirmRemove() {
    if (!card?.oracle_id) return;
    Alert.alert(
      "Remove from collection?",
      `This removes every copy of ${card.name} (all printings) from your collection.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setRemoving(true);
            try {
              await api.removeCard(card.oracle_id!);
              collectionCache = null;
              onRemoved?.();
              onClose();
            } catch (e) {
              Alert.alert("Couldn't remove card", e instanceof Error ? e.message : "Please try again.");
            } finally {
              setRemoving(false);
            }
          },
        },
      ],
    );
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <View className="flex-1">
            <Text className="text-lg font-semibold text-white" numberOfLines={2}>
              {card.name}
            </Text>
            <View className="mt-1 flex-row flex-wrap items-center gap-x-2 gap-y-1">
              {typeLine && <Text className="text-sm text-slate-400">{typeLine}</Text>}
              {manaCost && <ManaCost cost={manaCost} size={15} />}
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text className="text-lg text-slate-400">✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="pb-10">
          {current && (
            <View className="flex-row items-center gap-3 border-b border-slate-800 bg-slate-900/40 px-4 py-3">
              <SetSymbol iconUri={setInfo?.iconSvgUri} code={current.edition} size={28} />
              <View className="flex-1">
                <Text className="text-base font-semibold text-slate-100" numberOfLines={1}>
                  {setInfo?.name ?? current.edition?.toUpperCase() ?? "—"}
                </Text>
                <Text className="text-xs uppercase tracking-wider text-slate-500">
                  {current.edition?.toUpperCase() || "—"}
                  {current.collector_number ? `  #${current.collector_number}` : ""}
                  {foil ? "  · Foil" : ""}
                </Text>
              </View>
              {card.color_identity && <ColorPips colors={card.color_identity} size={16} />}
            </View>
          )}

          {owned.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingVertical: 10 }}
            >
              {owned.map((p, i) => (
                <TouchableOpacity
                  key={p.printing_key}
                  onPress={() => setIndexState(i)}
                  activeOpacity={0.7}
                  className={
                    "rounded border px-2 py-1 " +
                    (i === index ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700")
                  }
                >
                  <Text className={"text-[11px] font-medium uppercase " + (i === index ? "text-emerald-300" : "text-slate-400")}>
                    {p.printing_key === card.selected_printing_key ? "● " : ""}
                    {p.edition || "—"}
                    {p.finish === "foil" ? " ✦" : ""}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <View className="items-center px-4 pt-4">
            <CardImage
              key={current?.printing_key ?? `named:${card.name}`}
              name={card.name}
              printing={current}
              size="large"
              style={{ width: CARD_WIDTH, aspectRatio: 745 / 1040, borderRadius: 12 }}
            />
          </View>

          <View className="mt-5 px-4">
            <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
              {isOwned ? "Your copy" : "Details"}
            </Text>
            <View className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
              <Row
                label={`Market price${foil ? " (foil)" : ""}`}
                value={marketUsd != null ? `$${marketUsd.toFixed(2)}` : detail ? "—" : "…"}
                accent
              />
              {isOwned && current?.available != null && (
                <Row label="Available" value={`${current.available} of ${current.count}`} />
              )}
              {isOwned && <Row label="Owned" value={current ? String(current.count) : undefined} />}
              {isOwned && (
                <Row
                  label="You paid"
                  value={current?.purchase_price != null ? `$${current.purchase_price.toFixed(2)}` : undefined}
                />
              )}
              <Row label="Finish" value={foil ? "Foil" : "Nonfoil"} />
              {isOwned && <Row label="Condition" value={current?.condition} />}
            </View>
            {isOwned && totalCount != null ? (
              <Text className="mt-2 text-xs text-slate-500">
                Total owned across all printings: {totalCount}
              </Text>
            ) : !isOwned ? (
              <Text className="mt-2 text-xs text-slate-500">
                Not in your collection — showing the cheapest printing.
              </Text>
            ) : null}

            {oracleText && <Text className="mt-4 text-sm leading-5 text-slate-300">{oracleText}</Text>}

            {onSelectPrinting && owned.length > 0 && (
              <View className="mt-5">
                <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Which copy this deck uses
                </Text>
                {owned.map((p) => {
                  const isCurrent = p.printing_key === card.selected_printing_key;
                  return (
                    <TouchableOpacity
                      key={p.printing_key}
                      onPress={() => onSelectPrinting(p.printing_key)}
                      activeOpacity={0.6}
                      className="flex-row items-center gap-2 py-1.5"
                    >
                      <Text className={isCurrent ? "text-emerald-400" : "text-slate-700"}>●</Text>
                      <Text className={"text-xs " + (isCurrent ? "text-emerald-300" : "text-slate-300")}>
                        {(p.edition || "???").toUpperCase()} #{p.collector_number || "?"}
                      </Text>
                      <Text className="text-xs text-slate-500">{p.finish}</Text>
                      <Text className="text-xs text-slate-500">
                        {p.available != null ? `${p.available}/${p.count} free` : `×${p.count}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <Text className="mt-1 text-xs text-slate-500">Tap a printing to earmark that copy for this deck.</Text>
              </View>
            )}

            {onRemoved && card.oracle_id && isOwned && (
              <TouchableOpacity
                onPress={confirmRemove}
                disabled={removing}
                className="mt-8 rounded-lg border border-red-900/60 py-3"
                activeOpacity={0.7}
              >
                {removing ? (
                  <ActivityIndicator size="small" color="#f87171" />
                ) : (
                  <Text className="text-center text-sm text-red-400">Remove from collection</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
