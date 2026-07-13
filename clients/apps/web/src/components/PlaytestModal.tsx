import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeneratedDeck } from "@mtg/shared";
import { buildLibrary, sampleOpenerStats, shuffle, type LibCard, type OpenerStats } from "../lib/playtest";
import { scryfallNamedImageUrl } from "../lib/scryfall";
import ManaCost from "./ManaCost";

type Phase = "mulligan" | "bottoming" | "play";

interface BfCard extends LibCard {
  tapped: boolean;
}

interface Game {
  library: LibCard[];
  hand: LibCard[];
  battlefield: BfCard[];
  graveyard: LibCard[];
  exile: LibCard[];
  turn: number;
  mulligans: number;
  phase: Phase;
  landPlayedThisTurn: boolean;
}

function freshGame(lib: LibCard[]): Game {
  const shuffled = shuffle(lib);
  return {
    library: shuffled.slice(7),
    hand: shuffled.slice(0, 7),
    battlefield: [],
    graveyard: [],
    exile: [],
    turn: 0,
    mulligans: 0,
    phase: "mulligan",
    landPlayedThisTurn: false,
  };
}

// Small card image (fast loading, ~142x204)
function cardImg(name: string): string {
  return scryfallNamedImageUrl(name, "small");
}

// Visual card component — shows a small card image with interactions
function VisualCard({
  card,
  tapped,
  selected,
  label,
  onClick,
  onRightClick,
  size = "md",
}: {
  card: LibCard;
  tapped?: boolean;
  selected?: boolean;
  label?: string;
  onClick?: () => void;
  onRightClick?: () => void;
  size?: "sm" | "md";
}) {
  const w = size === "sm" ? "w-[60px]" : "w-[80px]";
  const h = size === "sm" ? "h-[84px]" : "h-[112px]";
  return (
    <div
      className={
        "relative shrink-0 cursor-pointer select-none transition-transform " +
        (tapped ? "rotate-90 " : "") +
        (selected ? "ring-2 ring-rose-500 ring-offset-1 ring-offset-slate-950 " : "") +
        (onClick ? "hover:scale-105 hover:-translate-y-1 " : "")
      }
      onClick={onClick}
      onContextMenu={(e) => {
        if (onRightClick) { e.preventDefault(); onRightClick(); }
      }}
      title={card.name + (label ? ` — ${label}` : "") + (onRightClick ? " (right-click: graveyard)" : "")}
    >
      <img
        src={cardImg(card.name)}
        alt={card.name}
        loading="lazy"
        className={`${w} ${h} rounded-md border border-slate-700 object-cover`}
      />
      {label && (
        <div className="absolute -bottom-1 left-0 right-0 truncate rounded-b bg-black/80 px-1 text-center text-[8px] text-white">
          {label}
        </div>
      )}
    </div>
  );
}

// Zone pile — shows a stack with a count badge (for graveyard/exile)
function ZonePile({
  cards,
  label,
  onClick,
}: {
  cards: LibCard[];
  label: string;
  onClick?: () => void;
}) {
  if (cards.length === 0) return null;
  const top = cards[cards.length - 1];
  return (
    <div className="flex flex-col items-center gap-1" onClick={onClick} title={`${label}: ${cards.length} cards`}>
      <div className="relative cursor-pointer">
        <img
          src={cardImg(top.name)}
          alt={top.name}
          loading="lazy"
          className="h-[84px] w-[60px] rounded-md border border-slate-700 object-cover opacity-80"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/70 px-2 py-0.5 text-sm font-bold text-white">
            {cards.length}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

export default function PlaytestModal({
  deck,
  onClose,
}: {
  deck: GeneratedDeck;
  onClose: () => void;
}) {
  const library0 = useMemo(() => buildLibrary(deck.cards), [deck]);
  const [game, setGame] = useState<Game>(() => freshGame(library0));
  const [toBottom, setToBottom] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<OpenerStats | null>(null);
  const [gySidebar, setGySidebar] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "d" && game.phase === "play") nextTurn();
      if (e.key === "u" && game.phase === "play") untapAll();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, game.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const landsInPlay = game.battlefield.filter((c) => c.isLand);
  const nonlandsInPlay = game.battlefield.filter((c) => !c.isLand);
  const untappedLands = landsInPlay.filter((c) => !c.tapped).length;

  function newGame() {
    setGame(freshGame(library0));
    setToBottom(new Set());
    setStats(null);
  }

  function mulligan() {
    setGame((g) => {
      const shuffled = shuffle(library0);
      return { ...freshGame(library0), library: shuffled.slice(7), hand: shuffled.slice(0, 7), mulligans: g.mulligans + 1 };
    });
    setToBottom(new Set());
  }

  function keep() {
    setGame((g) => {
      if (g.mulligans > 0) return { ...g, phase: "bottoming" };
      return { ...g, phase: "play", turn: 1 };
    });
  }

  function toggleBottom(uid: string) {
    setToBottom((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else if (next.size < game.mulligans) next.add(uid);
      return next;
    });
  }

  function confirmBottom() {
    setGame((g) => {
      const kept = g.hand.filter((c) => !toBottom.has(c.uid));
      const bottomed = g.hand.filter((c) => toBottom.has(c.uid));
      return { ...g, hand: kept, library: [...g.library, ...bottomed], phase: "play", turn: 1 };
    });
    setToBottom(new Set());
  }

  const nextTurn = useCallback(() => {
    setGame((g) => {
      // Untap all at start of turn
      const bf = g.battlefield.map((c) => ({ ...c, tapped: false }));
      if (g.library.length === 0) return { ...g, battlefield: bf, turn: g.turn + 1, landPlayedThisTurn: false };
      const [drawn, ...rest] = g.library;
      return { ...g, hand: [...g.hand, drawn], library: rest, battlefield: bf, turn: g.turn + 1, landPlayedThisTurn: false };
    });
  }, []);

  const untapAll = useCallback(() => {
    setGame((g) => ({
      ...g,
      battlefield: g.battlefield.map((c) => ({ ...c, tapped: false })),
    }));
  }, []);

  function playCard(uid: string) {
    setGame((g) => {
      const card = g.hand.find((c) => c.uid === uid);
      if (!card) return g;
      if (card.isLand && g.landPlayedThisTurn) return g;
      return {
        ...g,
        hand: g.hand.filter((c) => c.uid !== uid),
        battlefield: [...g.battlefield, { ...card, tapped: !card.isLand }],
        landPlayedThisTurn: card.isLand ? true : g.landPlayedThisTurn,
      };
    });
  }

  function tapToggle(uid: string) {
    setGame((g) => ({
      ...g,
      battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: !c.tapped } : c),
    }));
  }

  function toGraveyard(uid: string, from: "battlefield" | "hand") {
    setGame((g) => {
      const src = from === "battlefield" ? g.battlefield : g.hand;
      const card = src.find((c) => c.uid === uid);
      if (!card) return g;
      return {
        ...g,
        [from]: src.filter((c) => c.uid !== uid),
        graveyard: [...g.graveyard, card],
      };
    });
  }

  function toExile(uid: string, from: "battlefield" | "hand" | "graveyard") {
    setGame((g) => {
      const src = from === "battlefield" ? g.battlefield : from === "hand" ? g.hand : g.graveyard;
      const card = src.find((c) => c.uid === uid);
      if (!card) return g;
      return {
        ...g,
        [from]: src.filter((c) => c.uid !== uid),
        exile: [...g.exile, card],
      };
    });
  }

  function gyToHand(uid: string) {
    setGame((g) => {
      const card = g.graveyard.find((c) => c.uid === uid);
      if (!card) return g;
      return {
        ...g,
        graveyard: g.graveyard.filter((c) => c.uid !== uid),
        hand: [...g.hand, card],
      };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-slate-100">
            Playtest — {deck.commander.name}
          </h2>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>Turn <b className="text-slate-200">{game.phase === "play" ? game.turn : "—"}</b></span>
            <span>Library <b className="text-slate-300">{game.library.length}</b></span>
            <span>Mana <b className="text-emerald-400">{untappedLands}</b>/<b className="text-slate-300">{landsInPlay.length}</b></span>
            {game.mulligans > 0 && <span className="text-amber-400">Mull'd {game.mulligans}x</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {game.phase === "mulligan" && (
            <>
              <button onClick={keep} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500">
                Keep
              </button>
              <button onClick={mulligan} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                Mulligan (to {7 - (game.mulligans + 1)})
              </button>
            </>
          )}
          {game.phase === "bottoming" && (
            <>
              <span className="text-xs text-amber-300">
                Bottom {game.mulligans} ({toBottom.size}/{game.mulligans})
              </span>
              <button
                onClick={confirmBottom}
                disabled={toBottom.size !== game.mulligans}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Confirm
              </button>
            </>
          )}
          {game.phase === "play" && (
            <>
              <button onClick={nextTurn} className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500">
                Draw (D)
              </button>
              <button onClick={untapAll} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                Untap all (U)
              </button>
            </>
          )}
          <button onClick={newGame} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
            New game
          </button>
          <button
            onClick={() => setStats(sampleOpenerStats(deck.cards, 1000))}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
            title="Monte-Carlo 1,000 opening hands"
          >
            Stats
          </button>
          <button onClick={onClose} className="ml-2 text-slate-500 hover:text-slate-200" title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>

      {/* Stats bar (if shown) */}
      {stats && (
        <div className="flex items-center gap-4 border-b border-slate-800 bg-slate-900/50 px-4 py-1.5 text-xs text-slate-300">
          <span>Avg lands: <b>{stats.avgLands.toFixed(1)}</b></span>
          <span className="text-emerald-400">Keepable (2-5): <b>{stats.keepablePct.toFixed(0)}%</b></span>
          <span className="text-rose-400">Screw (0-1): <b>{stats.screwPct.toFixed(0)}%</b></span>
          <span className="text-amber-400">Flood (6-7): <b>{stats.floodPct.toFixed(0)}%</b></span>
          <div className="flex items-end gap-0.5">
            {stats.landDist.map((frac, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="w-4 rounded-t bg-sky-700" style={{ height: `${Math.max(1, frac * 40)}px` }} />
                <span className="text-[8px] text-slate-600">{i}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setStats(null)} className="ml-auto text-slate-600 hover:text-slate-400">✕</button>
        </div>
      )}

      {/* Main play area */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Battlefield */}
          <div className="flex-1 overflow-auto p-4">
            {/* Nonland permanents */}
            {nonlandsInPlay.length > 0 && (
              <div className="mb-4">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">Creatures & other permanents</div>
                <div className="flex flex-wrap gap-2">
                  {nonlandsInPlay.map((c) => (
                    <VisualCard
                      key={c.uid}
                      card={c}
                      tapped={c.tapped}
                      onClick={() => tapToggle(c.uid)}
                      onRightClick={() => toGraveyard(c.uid, "battlefield")}
                    />
                  ))}
                </div>
              </div>
            )}
            {/* Lands */}
            {landsInPlay.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">Lands</div>
                <div className="flex flex-wrap gap-1.5">
                  {landsInPlay.map((c) => (
                    <VisualCard
                      key={c.uid}
                      card={c}
                      tapped={c.tapped}
                      size="sm"
                      onClick={() => tapToggle(c.uid)}
                      onRightClick={() => toGraveyard(c.uid, "battlefield")}
                    />
                  ))}
                </div>
              </div>
            )}
            {game.phase === "play" && game.battlefield.length === 0 && (
              <div className="flex h-32 items-center justify-center text-sm text-slate-600">
                Click a card in hand to play it. Lands enter untapped, spells enter tapped (as a reminder to resolve).
              </div>
            )}
          </div>

          {/* Hand */}
          <div className="border-t border-slate-800 bg-slate-900/50 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                Hand ({game.hand.length})
              </span>
              {game.phase === "play" && game.landPlayedThisTurn && (
                <span className="text-[10px] text-slate-600">Land played this turn</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {game.hand.map((c) => {
                const canPlay = game.phase === "play" && (c.isLand ? !game.landPlayedThisTurn : true);
                const selected = toBottom.has(c.uid);
                let label: string | undefined;
                if (game.phase === "play" && c.isLand && !game.landPlayedThisTurn) label = "Play land";
                else if (game.phase === "play" && !c.isLand && c.cmc <= untappedLands) label = "Cast";
                else if (game.phase === "bottoming") label = selected ? "→ Bottom" : undefined;
                return (
                  <VisualCard
                    key={c.uid}
                    card={c}
                    selected={selected}
                    label={label}
                    onClick={() => {
                      if (game.phase === "bottoming") toggleBottom(c.uid);
                      else if (canPlay) playCard(c.uid);
                    }}
                    onRightClick={game.phase === "play" ? () => toGraveyard(c.uid, "hand") : undefined}
                  />
                );
              })}
              {game.hand.length === 0 && game.phase === "play" && (
                <span className="py-4 text-sm text-slate-600">Empty hand</span>
              )}
            </div>
          </div>
        </div>

        {/* Side zones: graveyard + exile */}
        <div className="flex w-24 flex-col items-center gap-3 border-l border-slate-800 bg-slate-900/30 p-2 pt-4">
          <ZonePile
            cards={game.graveyard}
            label="Graveyard"
            onClick={() => setGySidebar(!gySidebar)}
          />
          <ZonePile cards={game.exile} label="Exile" />
          <div className="mt-auto text-center text-[9px] leading-tight text-slate-600">
            Click → play/tap<br />
            Right-click → graveyard
          </div>
        </div>
      </div>

      {/* Graveyard sidebar */}
      {gySidebar && game.graveyard.length > 0 && (
        <div className="absolute right-24 top-12 z-10 w-72 max-h-[80vh] overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-300">Graveyard ({game.graveyard.length})</span>
            <button onClick={() => setGySidebar(false)} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
          </div>
          <div className="space-y-1">
            {game.graveyard.map((c) => (
              <div key={c.uid} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                  <img src={cardImg(c.name)} alt="" className="h-10 w-7 rounded object-cover" />
                  <span className="truncate text-slate-200">{c.name}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => gyToHand(c.uid)}
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
                    title="Return to hand"
                  >
                    Hand
                  </button>
                  <button
                    onClick={() => toExile(c.uid, "graveyard")}
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
                    title="Exile"
                  >
                    Exile
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
