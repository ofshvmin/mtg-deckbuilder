import { useMemo, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, Dimensions } from "react-native";
import {
  buildLibrary,
  sampleOpenerStats,
  shuffle,
  type GeneratedDeck,
  type LibCard,
} from "@mtg/shared";
import CardImage from "./CardImage";

// Goldfish a deck: how often the opening seven works, then a sample game — a
// London mulligan, draws, and a battlefield where lands tap for mana. The web's
// board has drag-and-drop zones and a graveyard and exile; a phone gets the
// part that answers "does this deck function": hand, lands, turns. Built on the
// shared playtest helpers, so the odds are computed identically.

const SCREEN_WIDTH = Dimensions.get("window").width;
const HAND_CARD = (SCREEN_WIDTH - 16 * 2 - 8 * 3) / 3.4;
const FIELD_CARD = (SCREEN_WIDTH - 16 * 2 - 6 * 4) / 5;

type Phase = "mulligan" | "bottoming" | "play";

interface Game {
  library: LibCard[];
  hand: LibCard[];
  battlefield: (LibCard & { tapped: boolean })[];
  turn: number;
  mulligans: number;
  phase: Phase;
  landPlayed: boolean;
}

function freshGame(lib: LibCard[], mulligans = 0): Game {
  const shuffled = shuffle(lib);
  return {
    library: shuffled.slice(7),
    hand: shuffled.slice(0, 7),
    battlefield: [],
    turn: 0,
    mulligans,
    phase: "mulligan",
    landPlayed: false,
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center rounded-lg border border-slate-800 bg-slate-900/60 py-2">
      <Text className="text-base font-semibold text-slate-100">{value}</Text>
      <Text className="text-[10px] uppercase tracking-wider text-slate-500">{label}</Text>
    </View>
  );
}

function Button({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      className={
        "flex-1 rounded-lg py-2.5 disabled:opacity-40 " + (primary ? "bg-emerald-700" : "border border-slate-700")
      }
    >
      <Text className={"text-center text-sm " + (primary ? "font-semibold text-white" : "text-slate-200")}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function PlaytestModal({ deck, onClose }: { deck: GeneratedDeck; onClose: () => void }) {
  const library = useMemo(() => buildLibrary(deck.cards), [deck.cards]);
  const stats = useMemo(() => sampleOpenerStats(deck.cards, 2000), [deck.cards]);
  const images = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of deck.cards) if (c.image_uris?.normal) m.set(c.name, c.image_uris.normal);
    return m;
  }, [deck.cards]);

  const [game, setGame] = useState<Game>(() => freshGame(library));
  const [toBottom, setToBottom] = useState<Set<string>>(new Set());

  const untappedLands = game.battlefield.filter((c) => c.isLand && !c.tapped).length;
  const landsInPlay = game.battlefield.filter((c) => c.isLand).length;

  function keep() {
    if (game.mulligans === 0) setGame({ ...game, phase: "play", turn: 1 });
    else {
      setToBottom(new Set());
      setGame({ ...game, phase: "bottoming" });
    }
  }

  // London mulligan: draw a fresh seven, then bottom one card per mulligan taken.
  function mulligan() {
    setGame(freshGame(library, game.mulligans + 1));
  }

  function confirmBottom() {
    const bottom = game.hand.filter((c) => toBottom.has(c.uid));
    setGame({
      ...game,
      hand: game.hand.filter((c) => !toBottom.has(c.uid)),
      library: [...game.library, ...bottom],
      phase: "play",
      turn: 1,
    });
  }

  function draw() {
    if (!game.library.length) return;
    setGame({ ...game, hand: [...game.hand, game.library[0]], library: game.library.slice(1) });
  }

  // Next turn: untap everything, draw, and a land drop is available again.
  function nextTurn() {
    const [top, ...rest] = game.library;
    setGame({
      ...game,
      turn: game.turn + 1,
      landPlayed: false,
      battlefield: game.battlefield.map((c) => ({ ...c, tapped: false })),
      hand: top ? [...game.hand, top] : game.hand,
      library: top ? rest : game.library,
    });
  }

  function play(card: LibCard) {
    if (card.isLand && game.landPlayed) return;
    setGame({
      ...game,
      hand: game.hand.filter((c) => c.uid !== card.uid),
      battlefield: [...game.battlefield, { ...card, tapped: card.isLand && card.etbTapped }],
      landPlayed: game.landPlayed || card.isLand,
    });
  }

  function toggleTap(uid: string) {
    setGame({
      ...game,
      battlefield: game.battlefield.map((c) => (c.uid === uid ? { ...c, tapped: !c.tapped } : c)),
    });
  }

  function onHandPress(card: LibCard) {
    if (game.phase === "bottoming") {
      setToBottom((prev) => {
        const next = new Set(prev);
        if (next.has(card.uid)) next.delete(card.uid);
        else if (next.size < game.mulligans) next.add(card.uid);
        return next;
      });
    } else if (game.phase === "play") {
      play(card);
    }
  }

  const handLands = game.hand.filter((c) => c.isLand).length;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View className="flex-1 bg-slate-950 pt-14">
        <View className="flex-row items-center justify-between px-4 pb-3">
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text className="text-sm text-indigo-400">← Back</Text>
          </TouchableOpacity>
          <Text className="text-base font-semibold text-white">Playtest</Text>
          <TouchableOpacity
            onPress={() => {
              setToBottom(new Set());
              setGame(freshGame(library));
            }}
            hitSlop={8}
          >
            <Text className="text-sm text-emerald-400">New game</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-4" contentContainerClassName="pb-10">
          <Text className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Opening hands ({stats.iterations.toLocaleString()} samples)
          </Text>
          <View className="mt-2 flex-row gap-2">
            <Stat label="Avg lands" value={stats.avgLands.toFixed(1)} />
            <Stat label="Keepable 2–5" value={`${stats.keepablePct.toFixed(0)}%`} />
            <Stat label="Screw 0–1" value={`${stats.screwPct.toFixed(0)}%`} />
            <Stat label="Flood 6–7" value={`${stats.floodPct.toFixed(0)}%`} />
          </View>

          <View className="mt-5 flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-slate-100">
              {game.phase === "play" ? `Turn ${game.turn}` : game.mulligans ? `Mulligan ${game.mulligans}` : "Opening hand"}
            </Text>
            <Text className="text-xs text-slate-500">
              Library {game.library.length} · {landsInPlay} land{landsInPlay === 1 ? "" : "s"} in play
              {game.phase === "play" ? ` · ${untappedLands} mana` : ""}
            </Text>
          </View>

          {game.phase === "mulligan" && (
            <>
              <Text className="mt-1 text-xs text-slate-500">
                {handLands} land{handLands === 1 ? "" : "s"} in hand. Keep, or mulligan to a new seven.
              </Text>
              <View className="mt-3 flex-row gap-2">
                <Button label="Keep" onPress={keep} primary />
                <Button label="Mulligan" onPress={mulligan} disabled={game.mulligans >= 6} />
              </View>
            </>
          )}
          {game.phase === "bottoming" && (
            <>
              <Text className="mt-1 text-xs text-amber-300">
                Choose {game.mulligans} card{game.mulligans === 1 ? "" : "s"} to put on the bottom ({toBottom.size}/
                {game.mulligans}).
              </Text>
              <View className="mt-3 flex-row gap-2">
                <Button label="Done" onPress={confirmBottom} primary disabled={toBottom.size !== game.mulligans} />
              </View>
            </>
          )}
          {game.phase === "play" && (
            <>
              <Text className="mt-1 text-xs text-slate-500">
                Tap a card in hand to play it{game.landPlayed ? " (land drop used)" : ""}. Tap a land in play to tap it.
              </Text>
              <View className="mt-3 flex-row gap-2">
                <Button label="Next turn" onPress={nextTurn} primary />
                <Button label="Draw" onPress={draw} disabled={!game.library.length} />
              </View>
            </>
          )}

          <Text className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-slate-500">
            Hand ({game.hand.length})
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {game.hand.map((c) => {
              const marked = toBottom.has(c.uid);
              const blocked = game.phase === "play" && c.isLand && game.landPlayed;
              return (
                <TouchableOpacity
                  key={c.uid}
                  onPress={() => onHandPress(c)}
                  activeOpacity={0.8}
                  style={{ width: HAND_CARD, opacity: marked || blocked ? 0.4 : 1 }}
                  className={marked ? "rounded-lg border-2 border-amber-400" : ""}
                >
                  <CardImage name={c.name} imageUrl={images.get(c.name)} style={{ width: HAND_CARD, borderRadius: 6 }} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {game.phase === "play" && (
            <>
              <Text className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-slate-500">
                Battlefield ({game.battlefield.length})
              </Text>
              {game.battlefield.length === 0 ? (
                <Text className="text-xs text-slate-600">Nothing in play yet.</Text>
              ) : (
                <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                  {game.battlefield.map((c) => (
                    <TouchableOpacity
                      key={c.uid}
                      onPress={() => c.isLand && toggleTap(c.uid)}
                      activeOpacity={0.8}
                      style={{ width: FIELD_CARD, opacity: c.tapped ? 0.45 : 1 }}
                    >
                      <CardImage name={c.name} imageUrl={images.get(c.name)} size="small" style={{ width: FIELD_CARD, borderRadius: 4 }} />
                      {c.tapped && <Text className="text-center text-[10px] text-slate-500">tapped</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
