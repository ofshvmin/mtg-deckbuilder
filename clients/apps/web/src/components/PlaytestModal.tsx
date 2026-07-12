import { useEffect, useMemo, useState } from "react";
import type { GeneratedDeck } from "@mtg/shared";
import { buildLibrary, sampleOpenerStats, shuffle, type LibCard, type OpenerStats } from "../lib/playtest";
import ManaCost from "./ManaCost";

type Phase = "mulligan" | "bottoming" | "play";

interface Game {
  library: LibCard[];
  hand: LibCard[];
  battlefield: LibCard[]; // lands in play
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
    turn: 0,
    mulligans: 0,
    phase: "mulligan",
    landPlayedThisTurn: false,
  };
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
  const [toBottom, setToBottom] = useState<string[]>([]);
  const [stats, setStats] = useState<OpenerStats | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mana = game.battlefield.length; // simplification: 1 land = 1 mana, colorless
  const castable = game.hand.filter((c) => !c.isLand && c.cmc <= mana).length;

  function newGame() {
    setGame(freshGame(library0));
    setToBottom([]);
  }

  function mulligan() {
    setGame((g) => {
      const shuffled = shuffle(library0);
      return { ...freshGame(library0), library: shuffled.slice(7), hand: shuffled.slice(0, 7), mulligans: g.mulligans + 1 };
    });
    setToBottom([]);
  }

  function keep() {
    setGame((g) => {
      if (g.mulligans > 0) return { ...g, phase: "bottoming" };
      return { ...g, phase: "play", turn: 1 };
    });
  }

  function toggleBottom(uid: string) {
    setToBottom((prev) => {
      if (prev.includes(uid)) return prev.filter((u) => u !== uid);
      if (prev.length >= game.mulligans) return prev; // can't select more than needed
      return [...prev, uid];
    });
  }

  function confirmBottom() {
    setGame((g) => {
      const kept = g.hand.filter((c) => !toBottom.includes(c.uid));
      const bottomed = g.hand.filter((c) => toBottom.includes(c.uid));
      return { ...g, hand: kept, library: [...g.library, ...bottomed], phase: "play", turn: 1 };
    });
    setToBottom([]);
  }

  function nextTurn() {
    setGame((g) => {
      if (g.library.length === 0) return { ...g, turn: g.turn + 1, landPlayedThisTurn: false };
      const [drawn, ...rest] = g.library;
      return { ...g, hand: [...g.hand, drawn], library: rest, turn: g.turn + 1, landPlayedThisTurn: false };
    });
  }

  function playLand(uid: string) {
    setGame((g) => {
      if (g.landPlayedThisTurn) return g;
      const card = g.hand.find((c) => c.uid === uid);
      if (!card || !card.isLand) return g;
      return {
        ...g,
        hand: g.hand.filter((c) => c.uid !== uid),
        battlefield: [...g.battlefield, card],
        landPlayedThisTurn: true,
      };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">
            🎴 Playtest — {deck.commander.name}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300" title="Close (Esc)">
            ✕
          </button>
        </div>

        {/* Status bar */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
          <span>Turn <span className="font-semibold text-slate-200">{game.phase === "play" ? game.turn : "—"}</span></span>
          <span>Library <span className="tabular-nums text-slate-300">{game.library.length}</span></span>
          <span>Mana <span className="tabular-nums text-slate-300">{mana}</span> <span className="text-slate-600">(lands; colors not simulated)</span></span>
          {game.mulligans > 0 && <span className="text-amber-400">Mulligans: {game.mulligans}</span>}
          {game.phase === "play" && <span className="text-emerald-400">Castable now: {castable}</span>}
          <button onClick={newGame} className="ml-auto rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
            New game
          </button>
        </div>

        {/* Controls */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {game.phase === "mulligan" && (
            <>
              <button onClick={keep} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
                Keep
              </button>
              <button onClick={mulligan} className="rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
                Mulligan (to {7 - (game.mulligans + 1)})
              </button>
            </>
          )}
          {game.phase === "bottoming" && (
            <>
              <span className="text-sm text-amber-300">
                Put {game.mulligans} card{game.mulligans > 1 ? "s" : ""} on the bottom ({toBottom.length}/{game.mulligans})
              </span>
              <button
                onClick={confirmBottom}
                disabled={toBottom.length !== game.mulligans}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Confirm
              </button>
            </>
          )}
          {game.phase === "play" && (
            <button onClick={nextTurn} className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500">
              Draw for turn →
            </button>
          )}
        </div>

        {/* Battlefield */}
        {game.battlefield.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Lands in play ({game.battlefield.length})
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {game.battlefield.map((c) => (
                <span key={c.uid} className="rounded bg-amber-900/30 px-2 py-0.5 text-xs text-amber-300">
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Hand */}
        <div className="mt-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Hand ({game.hand.length})
          </div>
          <ul className="mt-1 divide-y divide-slate-800/60 rounded-lg border border-slate-800">
            {game.hand.map((c) => {
              const selected = toBottom.includes(c.uid);
              const canCast = game.phase === "play" && !c.isLand && c.cmc <= mana;
              const clickable = game.phase === "bottoming" || (game.phase === "play" && c.isLand && !game.landPlayedThisTurn);
              return (
                <li
                  key={c.uid}
                  onClick={() => {
                    if (game.phase === "bottoming") toggleBottom(c.uid);
                    else if (game.phase === "play" && c.isLand) playLand(c.uid);
                  }}
                  className={
                    "flex items-center justify-between gap-3 px-3 py-1.5 text-sm " +
                    (clickable ? "cursor-pointer hover:bg-slate-900 " : "") +
                    (selected ? "bg-rose-950/40 " : "")
                  }
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={"truncate " + (canCast ? "text-emerald-300" : "text-slate-200")}>
                      {c.name}
                    </span>
                    {c.isLand && <span className="shrink-0 rounded bg-amber-900/30 px-1.5 text-[10px] text-amber-400">Land</span>}
                    {canCast && <span className="shrink-0 text-[10px] text-emerald-500">castable</span>}
                    {selected && <span className="shrink-0 text-[10px] text-rose-400">→ bottom</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.mana_cost && <ManaCost cost={c.mana_cost} className="text-xs" />}
                    {game.phase === "play" && c.isLand && !game.landPlayedThisTurn && (
                      <span className="rounded border border-slate-700 px-1.5 text-[10px] text-slate-300">Play</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {game.phase === "play" && game.landPlayedThisTurn && (
            <p className="mt-1 text-xs text-slate-500">Land played this turn — draw for next turn to play another.</p>
          )}
        </div>

        {/* Sample stats */}
        <div className="mt-5 border-t border-slate-800 pt-4">
          <button
            onClick={() => setStats(sampleOpenerStats(deck.cards, 1000))}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            📊 Sample 1,000 opening hands
          </button>
          {stats && (
            <div className="mt-3 text-sm text-slate-300">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>Avg lands: <b className="text-slate-100">{stats.avgLands.toFixed(2)}</b></span>
                <span className="text-emerald-400">Keepable (2–5): <b>{stats.keepablePct.toFixed(0)}%</b></span>
                <span className="text-rose-400">Screw (0–1): <b>{stats.screwPct.toFixed(0)}%</b></span>
                <span className="text-amber-400">Flood (6–7): <b>{stats.floodPct.toFixed(0)}%</b></span>
              </div>
              <div className="mt-2 flex items-end gap-1">
                {stats.landDist.map((frac, lands) => (
                  <div key={lands} className="flex flex-1 flex-col items-center">
                    <div className="w-full rounded-t bg-sky-700" style={{ height: `${Math.max(2, frac * 120)}px` }} />
                    <div className="mt-0.5 text-[10px] text-slate-500">{lands}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Lands in the opening 7 (before mulligan).</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
