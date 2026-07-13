import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeneratedDeck } from "@mtg/shared";
import { buildLibrary, sampleOpenerStats, shuffle, type LibCard, type OpenerStats } from "../lib/playtest";
import { scryfallNamedImageUrl } from "../lib/scryfall";

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

function cardImg(name: string): string {
  return scryfallNamedImageUrl(name, "normal");
}

// ---- Visual card component ----
function PlayCard({
  card,
  tapped,
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
  selected?: boolean;
  label?: string;
  onClick?: () => void;
  onRightClick?: () => void;
  onHover?: () => void;
  onLeave?: () => void;
  tall?: boolean;
}) {
  const imgClass = tall ? "h-[180px] w-[129px]" : "h-[100px] w-[72px]";

  return (
    <div
      className={
        "relative shrink-0 cursor-pointer select-none transition-all duration-150 " +
        (tapped ? "rotate-[20deg] translate-y-2 opacity-70 " : "") +
        (selected ? "ring-2 ring-rose-500 ring-offset-2 ring-offset-slate-950 rounded-lg " : "") +
        (onClick && !tapped ? "hover:-translate-y-1 " : "")
      }
      onClick={onClick}
      onContextMenu={(e) => {
        if (onRightClick) { e.preventDefault(); onRightClick(); }
      }}
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
        <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/80 px-1 py-0.5 text-center text-[9px] font-medium text-white">
          {label}
        </div>
      )}
    </div>
  );
}

// Zone pile (graveyard / exile)
function ZonePile({
  cards,
  label,
  onClick,
}: {
  cards: LibCard[];
  label: string;
  onClick?: () => void;
}) {
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-[80px] w-[57px] items-center justify-center rounded-lg border border-dashed border-slate-700 text-[10px] text-slate-700">
          {label}
        </div>
      </div>
    );
  }
  const top = cards[cards.length - 1];
  return (
    <div className="flex flex-col items-center gap-1 cursor-pointer" onClick={onClick}>
      <div className="relative">
        <img
          src={cardImg(top.name)}
          alt={top.name}
          loading="lazy"
          className="h-[80px] w-[57px] rounded-lg border border-slate-600 object-contain bg-slate-900 opacity-70"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/80 px-2 py-0.5 text-xs font-bold text-white">
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
  const [hoveredCard, setHoveredCard] = useState<string | null>(null); // card name for zoom

  const nextTurn = useCallback(() => {
    setGame((g) => {
      const bf = g.battlefield.map((c) => ({ ...c, tapped: false }));
      if (g.library.length === 0) return { ...g, battlefield: bf, turn: g.turn + 1, landPlayedThisTurn: false };
      const [drawn, ...rest] = g.library;
      return { ...g, hand: [...g.hand, drawn], library: rest, battlefield: bf, turn: g.turn + 1, landPlayedThisTurn: false };
    });
  }, []);

  const untapAll = useCallback(() => {
    setGame((g) => ({ ...g, battlefield: g.battlefield.map((c) => ({ ...c, tapped: false })) }));
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

  const landsInPlay = game.battlefield.filter((c) => c.isLand);
  const nonlandsInPlay = game.battlefield.filter((c) => !c.isLand);
  const untappedLands = landsInPlay.filter((c) => !c.tapped).length;

  function newGame() { setGame(freshGame(library0)); setToBottom(new Set()); setStats(null); }
  function mulligan() {
    setGame((g) => {
      const s = shuffle(library0);
      return { ...freshGame(library0), library: s.slice(7), hand: s.slice(0, 7), mulligans: g.mulligans + 1 };
    });
    setToBottom(new Set());
  }
  function keep() {
    setGame((g) => g.mulligans > 0 ? { ...g, phase: "bottoming" } : { ...g, phase: "play", turn: 1 });
  }
  function toggleBottom(uid: string) {
    setToBottom((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else if (next.size < game.mulligans) next.add(uid);
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
    setGame((g) => ({ ...g, battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: !c.tapped } : c) }));
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
          <h2 className="text-sm font-semibold text-slate-100">
            {deck.commander.name}
          </h2>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>Turn <b className="text-slate-200">{game.phase === "play" ? game.turn : "—"}</b></span>
            <span>Library <b className="text-slate-300">{game.library.length}</b></span>
            <span>Mana <b className="text-emerald-400">{untappedLands}</b>/<b className="text-slate-300">{landsInPlay.length}</b></span>
            {game.mulligans > 0 && <span className="text-amber-400">Mull {game.mulligans}x</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {game.phase === "mulligan" && (
            <>
              <button onClick={keep} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500">Keep</button>
              <button onClick={mulligan} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                Mulligan (to {7 - (game.mulligans + 1)})
              </button>
            </>
          )}
          {game.phase === "bottoming" && (
            <>
              <span className="text-xs text-amber-300">Bottom {game.mulligans} ({toBottom.size}/{game.mulligans})</span>
              <button onClick={confirmBottom} disabled={toBottom.size !== game.mulligans}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
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
                Untap (U)
              </button>
            </>
          )}
          <button onClick={newGame} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">New</button>
          <button onClick={() => setStats((s) => s ? null : sampleOpenerStats(deck.cards, 1000))}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">Stats</button>
          <button onClick={onClose} className="ml-1 text-slate-500 hover:text-slate-200" title="Esc">✕</button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
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

      {/* Main area: battlefield + side zones */}
      <div className="flex min-h-0 flex-1">
        {/* Battlefield */}
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
                    <PlayCard key={c.uid} card={c} tapped={c.tapped} tall
                      onClick={() => tapToggle(c.uid)}
                      onRightClick={() => toGraveyard(c.uid, "battlefield")}
                      onHover={() => setHoveredCard(c.name)}
                      onLeave={() => setHoveredCard(null)} />
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
                    onHover={() => setHoveredCard(c.name)}
                    onLeave={() => setHoveredCard(null)} />
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
            Click: play/tap<br />
            Right-click: GY
          </div>
        </div>
      </div>

      {/* Hand */}
      <div className="shrink-0 border-t border-slate-800 bg-slate-900/60 px-3 py-2">
        <div className="mb-1 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Hand ({game.hand.length})</span>
          {game.phase === "play" && game.landPlayedThisTurn && (
            <span className="text-[10px] text-slate-600">Land played this turn</span>
          )}
          {game.phase === "bottoming" && (
            <span className="text-[10px] text-amber-400">
              Select {game.mulligans} card{game.mulligans > 1 ? "s" : ""} to put on bottom
            </span>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {game.hand.map((c) => {
            const canPlay = game.phase === "play" && (c.isLand ? !game.landPlayedThisTurn : true);
            const selected = toBottom.has(c.uid);
            let label: string | undefined;
            if (game.phase === "play" && c.isLand && !game.landPlayedThisTurn) label = "Play land";
            else if (game.phase === "play" && !c.isLand && c.cmc <= untappedLands) label = "Cast";
            else if (game.phase === "bottoming" && selected) label = "Bottom";
            return (
              <PlayCard key={c.uid} card={c} selected={selected} label={label} tall
                onClick={() => {
                  if (game.phase === "bottoming") toggleBottom(c.uid);
                  else if (canPlay) playCard(c.uid);
                }}
                onRightClick={game.phase === "play" ? () => toGraveyard(c.uid, "hand") : undefined}
                onHover={() => setHoveredCard(c.name)}
                onLeave={() => setHoveredCard(null)} />
            );
          })}
          {game.hand.length === 0 && game.phase === "play" && (
            <span className="py-6 text-sm text-slate-600">Empty hand</span>
          )}
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

      {/* Hover zoom — large card centered on screen */}
      {hoveredCard && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <img
            src={scryfallNamedImageUrl(hoveredCard, "large")}
            alt={hoveredCard}
            className="h-[480px] w-[344px] rounded-2xl border-2 border-slate-600 object-contain shadow-2xl shadow-black/80"
          />
        </div>
      )}
    </div>
  );
}
