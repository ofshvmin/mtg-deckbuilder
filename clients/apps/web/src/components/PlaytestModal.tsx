import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeneratedDeck } from "@mtg/shared";
import { buildLibrary, sampleOpenerStats, shuffle, type LibCard, type OpenerStats } from "../lib/playtest";
import { scryfallNamedImageUrl } from "../lib/scryfall";

type Phase = "mulligan" | "bottoming" | "play";

interface BfCard extends LibCard {
  tapped: boolean;
  summoningSick: boolean; // creatures have summoning sickness the turn they enter
  enteredTurn: number;
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
  manaPool: number; // floating mana from tapping lands
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
    manaPool: 0,
  };
}

function cardImg(name: string): string {
  return scryfallNamedImageUrl(name, "normal");
}

// ---- Visual card ----
function PlayCard({
  card,
  tapped,
  sick,
  selected,
  label,
  onClick,
  onRightClick,
  onHover,
  onLeave,
  tall = false,
}: {
  card: LibCard;
  tapped?: boolean;
  sick?: boolean;    // summoning sickness = upside down
  selected?: boolean;
  label?: string;
  onClick?: () => void;
  onRightClick?: () => void;
  onHover?: () => void;
  onLeave?: () => void;
  tall?: boolean;
}) {
  const imgClass = tall ? "h-[180px] w-[129px]" : "h-[100px] w-[72px]";

  // Tapped = tilted right; summoning sick = upside down; both = tilted + upside down
  let transform = "";
  if (sick && tapped) transform = "rotate-[200deg] translate-y-2 opacity-70";
  else if (sick) transform = "rotate-180 opacity-80";
  else if (tapped) transform = "rotate-[20deg] translate-y-2 opacity-70";

  return (
    <div
      className={
        "relative shrink-0 cursor-pointer select-none transition-all duration-150 " +
        transform + " " +
        (selected ? "ring-2 ring-rose-500 ring-offset-2 ring-offset-slate-950 rounded-lg " : "") +
        (onClick && !tapped ? "hover:-translate-y-1 " : "")
      }
      onClick={onClick}
      onContextMenu={(e) => { if (onRightClick) { e.preventDefault(); onRightClick(); } }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <img
        src={cardImg(card.name)}
        alt={card.name}
        loading="lazy"
        className={`${imgClass} rounded-lg border border-slate-600 object-contain bg-slate-900`}
      />
      {label && (
        <div className={"absolute left-0 right-0 rounded-b-lg bg-black/80 px-1 py-0.5 text-center text-[9px] font-medium text-white " + (sick ? "top-0 rounded-t-lg rounded-b-none" : "bottom-0")}>
          {label}
        </div>
      )}
    </div>
  );
}

function ZonePile({ cards, label, onClick }: { cards: LibCard[]; label: string; onClick?: () => void }) {
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-[80px] w-[57px] items-center justify-center rounded-lg border border-dashed border-slate-700 text-[10px] text-slate-700">{label}</div>
      </div>
    );
  }
  const top = cards[cards.length - 1];
  return (
    <div className="flex flex-col items-center gap-1 cursor-pointer" onClick={onClick}>
      <div className="relative">
        <img src={cardImg(top.name)} alt={top.name} loading="lazy"
          className="h-[80px] w-[57px] rounded-lg border border-slate-600 object-contain bg-slate-900 opacity-70" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/80 px-2 py-0.5 text-xs font-bold text-white">{cards.length}</span>
        </div>
      </div>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

export default function PlaytestModal({ deck, onClose }: { deck: GeneratedDeck; onClose: () => void }) {
  const library0 = useMemo(() => buildLibrary(deck.cards), [deck]);
  const [game, setGame] = useState<Game>(() => freshGame(library0));
  const [toBottom, setToBottom] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<OpenerStats | null>(() => sampleOpenerStats(deck.cards, 1000));
  const [showStats, setShowStats] = useState(true);
  const [gySidebar, setGySidebar] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  const landsInPlay = game.battlefield.filter((c) => c.isLand);
  const nonlandsInPlay = game.battlefield.filter((c) => !c.isLand);
  const untappedLands = landsInPlay.filter((c) => !c.tapped).length;
  const availableMana = game.manaPool + untappedLands;

  // Commander mulligan: first mulligan is free (keep 7), second goes to 6, etc.
  const mulliganHandSize = game.mulligans <= 0 ? 7 : Math.max(1, 8 - game.mulligans);
  // Cards to bottom after keeping = 7 - mulliganHandSize (0 for free mull)
  const cardsToBottom = 7 - mulliganHandSize;

  const nextTurn = useCallback(() => {
    setGame((g) => {
      // Remove summoning sickness from creatures that entered on a previous turn
      const bf = g.battlefield.map((c) => ({
        ...c,
        tapped: false,
        summoningSick: c.summoningSick && c.enteredTurn === g.turn, // still sick if entered THIS turn
      })).map((c) => ({ ...c, summoningSick: false })); // new turn = all sickness clears
      const newTurn = g.turn + 1;
      if (g.library.length === 0) return { ...g, battlefield: bf, turn: newTurn, landPlayedThisTurn: false, manaPool: 0 };
      const [drawn, ...rest] = g.library;
      return { ...g, hand: [...g.hand, drawn], library: rest, battlefield: bf, turn: newTurn, landPlayedThisTurn: false, manaPool: 0 };
    });
  }, []);

  const untapAll = useCallback(() => {
    setGame((g) => ({ ...g, battlefield: g.battlefield.map((c) => ({ ...c, tapped: false })), manaPool: 0 }));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "d" && game.phase === "play") nextTurn();
      if (e.key === "u" && game.phase === "play") untapAll();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, game.phase, nextTurn, untapAll]);

  function newGame() { setGame(freshGame(library0)); setToBottom(new Set()); }
  function mulligan() {
    setGame((g) => {
      const s = shuffle(library0);
      return { ...freshGame(library0), library: s.slice(7), hand: s.slice(0, 7), mulligans: g.mulligans + 1 };
    });
    setToBottom(new Set());
  }
  function keep() {
    setGame((g) => {
      if (cardsToBottom > 0) return { ...g, phase: "bottoming" };
      return { ...g, phase: "play", turn: 1 };
    });
  }
  function toggleBottom(uid: string) {
    setToBottom((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else if (next.size < cardsToBottom) next.add(uid);
      return next;
    });
  }
  function confirmBottom() {
    setGame((g) => ({
      ...g,
      hand: g.hand.filter((c) => !toBottom.has(c.uid)),
      library: [...g.library, ...g.hand.filter((c) => toBottom.has(c.uid))],
      phase: "play", turn: 1,
    }));
    setToBottom(new Set());
  }

  function tapLand(uid: string) {
    setGame((g) => {
      const card = g.battlefield.find((c) => c.uid === uid);
      if (!card || !card.isLand || card.tapped) return g;
      return {
        ...g,
        battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: true } : c),
        manaPool: g.manaPool + 1,
      };
    });
  }

  function tapToggle(uid: string) {
    setGame((g) => {
      const card = g.battlefield.find((c) => c.uid === uid);
      if (!card) return g;
      if (card.isLand) {
        // Tapping a land adds mana; untapping removes it
        if (card.tapped) {
          return { ...g, battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: false } : c), manaPool: Math.max(0, g.manaPool - 1) };
        } else {
          return { ...g, battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: true } : c), manaPool: g.manaPool + 1 };
        }
      }
      // Non-land: just toggle
      return { ...g, battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: !c.tapped } : c) };
    });
  }

  function autoTapLands(cost: number): (g: Game) => Game {
    return (g) => {
      // Use floating mana first, then tap untapped lands
      let remaining = cost;
      let pool = g.manaPool;
      const spend = Math.min(pool, remaining);
      pool -= spend;
      remaining -= spend;

      const bf = g.battlefield.map((c) => {
        if (remaining <= 0 || !c.isLand || c.tapped) return c;
        remaining--;
        return { ...c, tapped: true };
      });
      return { ...g, battlefield: bf, manaPool: pool };
    };
  }

  function playCard(uid: string) {
    setGame((g) => {
      const card = g.hand.find((c) => c.uid === uid);
      if (!card) return g;

      if (card.isLand) {
        if (g.landPlayedThisTurn) return g;
        const tapped = card.etbTapped;
        return {
          ...g,
          hand: g.hand.filter((c) => c.uid !== uid),
          battlefield: [...g.battlefield, { ...card, tapped, summoningSick: false, enteredTurn: g.turn }],
          landPlayedThisTurn: true,
        };
      }

      // Spell: check if we can afford it
      const cost = Math.ceil(card.cmc);
      if (cost > availableMana) return g; // can't afford

      // Auto-tap lands to pay
      const afterTap = autoTapLands(cost)(g);
      const isCre = card.isCreature;
      return {
        ...afterTap,
        hand: afterTap.hand.filter((c) => c.uid !== uid),
        battlefield: [...afterTap.battlefield, { ...card, tapped: false, summoningSick: isCre, enteredTurn: g.turn }],
      };
    });
  }

  function toGraveyard(uid: string, from: "battlefield" | "hand") {
    setGame((g) => {
      const src = from === "battlefield" ? g.battlefield : g.hand;
      const card = src.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, [from]: src.filter((c) => c.uid !== uid), graveyard: [...g.graveyard, card] };
    });
  }
  function toExile(uid: string, from: "graveyard") {
    setGame((g) => {
      const card = g[from].find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, [from]: g[from].filter((c) => c.uid !== uid), exile: [...g.exile, card] };
    });
  }
  function gyToHand(uid: string) {
    setGame((g) => {
      const card = g.graveyard.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, graveyard: g.graveyard.filter((c) => c.uid !== uid), hand: [...g.hand, card] };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-slate-950">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-slate-100">{deck.commander.name}</h2>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>Turn <b className="text-slate-200">{game.phase === "play" ? game.turn : "—"}</b></span>
            <span>Library <b className="text-slate-300">{game.library.length}</b></span>
            <span>Mana <b className="text-emerald-400">{availableMana}</b>
              {game.manaPool > 0 && <span className="text-amber-400"> ({game.manaPool} floating)</span>}
            </span>
            {game.mulligans > 0 && <span className="text-amber-400">Mull {game.mulligans}x</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {game.phase === "mulligan" && (
            <>
              <button onClick={keep} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500">Keep</button>
              <button onClick={mulligan} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                Mulligan{game.mulligans === 0 ? " (free)" : ` (to ${mulliganHandSize - 1})`}
              </button>
            </>
          )}
          {game.phase === "bottoming" && (
            <>
              <span className="text-xs text-amber-300">Bottom {cardsToBottom} ({toBottom.size}/{cardsToBottom})</span>
              <button onClick={confirmBottom} disabled={toBottom.size !== cardsToBottom}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50">Confirm</button>
            </>
          )}
          {game.phase === "play" && (
            <>
              <button onClick={nextTurn} className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500">Draw (D)</button>
              <button onClick={untapAll} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">Untap (U)</button>
            </>
          )}
          <button onClick={newGame} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">New</button>
          <button onClick={() => setShowStats((s) => !s)}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
            {showStats ? "Hide stats" : "Stats"}
          </button>
          <button onClick={onClose} className="ml-1 text-slate-500 hover:text-slate-200" title="Esc">✕</button>
        </div>
      </div>

      {/* Stats bar (shown by default) */}
      {showStats && stats && (
        <div className="flex shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-900/50 px-4 py-1 text-xs text-slate-300">
          <span>Avg lands: <b>{stats.avgLands.toFixed(1)}</b></span>
          <span className="text-emerald-400">Keep (2-5): <b>{stats.keepablePct.toFixed(0)}%</b></span>
          <span className="text-rose-400">Screw: <b>{stats.screwPct.toFixed(0)}%</b></span>
          <span className="text-amber-400">Flood: <b>{stats.floodPct.toFixed(0)}%</b></span>
          <div className="flex items-end gap-0.5">
            {stats.landDist.map((frac, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="w-3 rounded-t bg-sky-700" style={{ height: `${Math.max(1, frac * 30)}px` }} />
                <span className="text-[7px] text-slate-600">{i}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex min-h-0 flex-1">
        <div className="flex flex-1 flex-col overflow-auto p-3">
          {/* Nonland permanents */}
          <div className="flex-1">
            {nonlandsInPlay.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-600">
                  Permanents ({nonlandsInPlay.length})
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  {nonlandsInPlay.map((c) => (
                    <PlayCard key={c.uid} card={c} tapped={c.tapped} sick={c.summoningSick} tall
                      label={c.summoningSick ? "Sick" : undefined}
                      onClick={() => tapToggle(c.uid)}
                      onRightClick={() => toGraveyard(c.uid, "battlefield")}
                      onHover={() => setHoveredCard(c.name)} onLeave={() => setHoveredCard(null)} />
                  ))}
                </div>
              </div>
            )}
            {game.phase === "play" && game.battlefield.length === 0 && (
              <div className="flex h-full items-center justify-center text-sm text-slate-700">
                Click cards in your hand to play them
              </div>
            )}
          </div>

          {/* Lands */}
          {landsInPlay.length > 0 && (
            <div className="mt-auto pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">
                Lands ({untappedLands}/{landsInPlay.length})
              </div>
              <div className="flex flex-wrap items-start gap-1.5">
                {landsInPlay.map((c) => (
                  <PlayCard key={c.uid} card={c} tapped={c.tapped}
                    onClick={() => tapToggle(c.uid)}
                    onRightClick={() => toGraveyard(c.uid, "battlefield")}
                    onHover={() => setHoveredCard(c.name)} onLeave={() => setHoveredCard(null)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Side zones */}
        <div className="flex w-20 shrink-0 flex-col items-center gap-3 border-l border-slate-800 bg-slate-900/30 p-2 pt-4">
          <ZonePile cards={game.graveyard} label="Graveyard" onClick={() => setGySidebar(!gySidebar)} />
          <ZonePile cards={game.exile} label="Exile" />
          <div className="mt-auto text-center text-[8px] leading-relaxed text-slate-700">
            Click: tap<br />Right-click: GY
          </div>
        </div>
      </div>

      {/* Hand */}
      <div className="shrink-0 border-t border-slate-800 bg-slate-900/60 px-3 py-2">
        <div className="mb-1 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Hand ({game.hand.length})</span>
          {game.phase === "play" && game.landPlayedThisTurn && <span className="text-[10px] text-slate-600">Land played</span>}
          {game.phase === "bottoming" && (
            <span className="text-[10px] text-amber-400">Select {cardsToBottom} to bottom</span>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {game.hand.map((c) => {
            const canPlay = game.phase === "play" && (c.isLand ? !game.landPlayedThisTurn : Math.ceil(c.cmc) <= availableMana);
            const selected = toBottom.has(c.uid);
            let label: string | undefined;
            if (game.phase === "play" && c.isLand && !game.landPlayedThisTurn) label = "Play land";
            else if (game.phase === "play" && !c.isLand && canPlay) label = `Cast (${Math.ceil(c.cmc)})`;
            else if (game.phase === "bottoming" && selected) label = "Bottom";
            return (
              <PlayCard key={c.uid} card={c} selected={selected} label={label} tall
                onClick={() => {
                  if (game.phase === "bottoming") toggleBottom(c.uid);
                  else if (canPlay) playCard(c.uid);
                }}
                onRightClick={game.phase === "play" ? () => toGraveyard(c.uid, "hand") : undefined}
                onHover={() => setHoveredCard(c.name)} onLeave={() => setHoveredCard(null)} />
            );
          })}
          {game.hand.length === 0 && game.phase === "play" && <span className="py-6 text-sm text-slate-600">Empty hand</span>}
        </div>
      </div>

      {/* Graveyard sidebar */}
      {gySidebar && game.graveyard.length > 0 && (
        <div className="absolute bottom-0 right-20 top-10 z-10 w-64 overflow-auto border-l border-slate-700 bg-slate-950 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">Graveyard ({game.graveyard.length})</span>
            <button onClick={() => setGySidebar(false)} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
          </div>
          <div className="space-y-1.5">
            {game.graveyard.map((c) => (
              <div key={c.uid} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-800/60"
                onMouseEnter={() => setHoveredCard(c.name)} onMouseLeave={() => setHoveredCard(null)}>
                <img src={cardImg(c.name)} alt="" className="h-14 w-10 shrink-0 rounded object-contain bg-slate-900" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-slate-200">{c.name}</div>
                  <div className="mt-1 flex gap-1">
                    <button onClick={() => gyToHand(c.uid)}
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700">Hand</button>
                    <button onClick={() => toExile(c.uid, "graveyard")}
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700">Exile</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hover zoom */}
      {hoveredCard && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <img src={scryfallNamedImageUrl(hoveredCard, "large")} alt={hoveredCard}
            className="h-[480px] w-[344px] rounded-2xl border-2 border-slate-600 object-contain shadow-2xl shadow-black/80" />
        </div>
      )}
    </div>
  );
}
