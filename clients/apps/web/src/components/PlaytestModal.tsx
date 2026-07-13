import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeneratedDeck } from "@mtg/shared";
import { buildLibrary, sampleOpenerStats, shuffle, type LibCard, type OpenerStats } from "../lib/playtest";
import { scryfallNamedImageUrl } from "../lib/scryfall";

type Phase = "mulligan" | "bottoming" | "play";

interface BfCard extends LibCard {
  tapped: boolean;
  summoningSick: boolean;
  enteredTurn: number;
}

interface Game {
  library: LibCard[];
  hand: LibCard[];
  battlefield: BfCard[];
  graveyard: LibCard[];
  exile: LibCard[];
  commandZone: boolean; // true = commander is in command zone (not on battlefield)
  turn: number;
  mulligans: number;
  phase: Phase;
  landPlayedThisTurn: boolean;
  manaPool: number;
}

function freshGame(lib: LibCard[]): Game {
  const shuffled = shuffle(lib);
  return {
    library: shuffled.slice(7),
    hand: shuffled.slice(0, 7),
    battlefield: [],
    graveyard: [],
    exile: [],
    commandZone: true,
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

function PlayCard({
  card, tapped, sick, selected, label, onClick, onRightClick, onHover, onLeave, tall = false,
}: {
  card: LibCard; tapped?: boolean; sick?: boolean; selected?: boolean; label?: string;
  onClick?: () => void; onRightClick?: () => void; onHover?: () => void; onLeave?: () => void;
  tall?: boolean;
}) {
  const imgClass = tall ? "h-[180px] w-[129px]" : "h-[100px] w-[72px]";
  let transform = "";
  if (sick && tapped) transform = "rotate-[270deg] opacity-70";
  else if (sick) transform = "rotate-180 opacity-80";
  else if (tapped) transform = "rotate-90 opacity-80";

  return (
    <div
      className={
        "relative shrink-0 cursor-pointer select-none transition-all duration-150 " + transform + " " +
        (selected ? "ring-2 ring-rose-500 ring-offset-2 ring-offset-slate-950 rounded-lg " : "") +
        (onClick && !tapped ? "hover:-translate-y-1 " : "")
      }
      onClick={onClick}
      onContextMenu={(e) => { if (onRightClick) { e.preventDefault(); onRightClick(); } }}
      onMouseEnter={onHover} onMouseLeave={onLeave}
    >
      <img src={cardImg(card.name)} alt={card.name} loading="lazy"
        className={`${imgClass} rounded-lg border border-slate-600 object-contain bg-slate-900`} />
      {label && (
        <div className={"absolute left-0 right-0 bg-black/80 px-1 py-0.5 text-center text-[9px] font-medium text-white " +
          (sick && !tapped ? "top-0 rounded-t-lg" : "bottom-0 rounded-b-lg")}>
          {label}
        </div>
      )}
    </div>
  );
}

function ZonePile({ cards, label, onClick, faceDown }: {
  cards: LibCard[]; label: string; onClick?: () => void; faceDown?: boolean;
}) {
  const empty = cards.length === 0;
  return (
    <div className="flex flex-col items-center gap-1 cursor-pointer" onClick={onClick}
      title={`${label}: ${cards.length} cards`}>
      <div className="relative">
        {empty ? (
          <div className="flex h-[80px] w-[57px] items-center justify-center rounded-lg border border-dashed border-slate-700 text-[9px] text-slate-700">
            {label}
          </div>
        ) : faceDown ? (
          <div className="flex h-[80px] w-[57px] items-center justify-center rounded-lg border border-slate-600 bg-gradient-to-br from-slate-700 to-slate-800">
            <span className="text-lg font-bold text-slate-500">{cards.length}</span>
          </div>
        ) : (
          <>
            <img src={cardImg(cards[cards.length - 1].name)} alt="" loading="lazy"
              className="h-[80px] w-[57px] rounded-lg border border-slate-600 object-contain bg-slate-900 opacity-70" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/80 px-2 py-0.5 text-xs font-bold text-white">{cards.length}</span>
            </div>
          </>
        )}
      </div>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

// Sidebar to browse a zone (library, graveyard) with actions
function ZoneBrowser({ title, cards, onClose, actions, onHover, onLeave }: {
  title: string;
  cards: LibCard[];
  onClose: () => void;
  actions: (card: LibCard, idx: number) => { label: string; onClick: () => void }[];
  onHover: (name: string) => void;
  onLeave: () => void;
}) {
  return (
    <div className="absolute bottom-0 right-20 top-10 z-10 w-72 overflow-auto border-l border-slate-700 bg-slate-950 p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">{title} ({cards.length})</span>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
      </div>
      <div className="space-y-1">
        {cards.map((c, i) => (
          <div key={c.uid} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-800/60"
            onMouseEnter={() => onHover(c.name)} onMouseLeave={onLeave}>
            <img src={cardImg(c.name)} alt="" className="h-14 w-10 shrink-0 rounded object-contain bg-slate-900" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-slate-200">{c.name}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {actions(c, i).map((a) => (
                  <button key={a.label} onClick={a.onClick}
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700">
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type Sidebar = "library" | "graveyard" | "exile" | null;

export default function PlaytestModal({ deck, onClose }: { deck: GeneratedDeck; onClose: () => void }) {
  const library0 = useMemo(() => buildLibrary(deck.cards), [deck]);
  const [game, setGame] = useState<Game>(() => freshGame(library0));
  const [toBottom, setToBottom] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<OpenerStats | null>(() => sampleOpenerStats(deck.cards, 1000));
  const [showStats, setShowStats] = useState(true);
  const [sidebar, setSidebar] = useState<Sidebar>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  const landsInPlay = game.battlefield.filter((c) => c.isLand);
  const nonlandsInPlay = game.battlefield.filter((c) => !c.isLand);
  const untappedLands = landsInPlay.filter((c) => !c.tapped).length;
  const availableMana = game.manaPool + untappedLands;
  const mulliganHandSize = game.mulligans <= 0 ? 7 : Math.max(1, 8 - game.mulligans);
  const cardsToBottom = 7 - mulliganHandSize;

  const nextTurn = useCallback(() => {
    setGame((g) => {
      const bf = g.battlefield.map((c) => ({ ...c, tapped: false, summoningSick: false }));
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
      if (e.key === "Escape") { if (sidebar) setSidebar(null); else onClose(); }
      if (e.key === "d" && game.phase === "play") nextTurn();
      if (e.key === "u" && game.phase === "play") untapAll();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, game.phase, nextTurn, untapAll, sidebar]);

  function newGame() { setGame(freshGame(library0)); setToBottom(new Set()); setSidebar(null); }
  function mulligan() {
    setGame((g) => {
      const s = shuffle(library0);
      return { ...freshGame(library0), library: s.slice(7), hand: s.slice(0, 7), mulligans: g.mulligans + 1 };
    });
    setToBottom(new Set());
  }
  function keep() {
    setGame((g) => cardsToBottom > 0 ? { ...g, phase: "bottoming" } : { ...g, phase: "play", turn: 1 });
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
  function tapToggle(uid: string) {
    setGame((g) => {
      const card = g.battlefield.find((c) => c.uid === uid);
      if (!card) return g;
      if (card.isLand) {
        if (card.tapped) return { ...g, battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: false } : c), manaPool: Math.max(0, g.manaPool - 1) };
        return { ...g, battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: true } : c), manaPool: g.manaPool + 1 };
      }
      return { ...g, battlefield: g.battlefield.map((c) => c.uid === uid ? { ...c, tapped: !c.tapped } : c) };
    });
  }
  function autoTapLands(cost: number): (g: Game) => Game {
    return (g) => {
      let remaining = cost;
      let pool = g.manaPool;
      const spend = Math.min(pool, remaining); pool -= spend; remaining -= spend;
      const bf = g.battlefield.map((c) => {
        if (remaining <= 0 || !c.isLand || c.tapped) return c;
        remaining--; return { ...c, tapped: true };
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
        return { ...g, hand: g.hand.filter((c) => c.uid !== uid),
          battlefield: [...g.battlefield, { ...card, tapped: card.etbTapped, summoningSick: false, enteredTurn: g.turn }],
          landPlayedThisTurn: true };
      }
      const cost = Math.ceil(card.cmc);
      const am = g.manaPool + g.battlefield.filter((c) => c.isLand && !c.tapped).length;
      if (cost > am) return g;
      const after = autoTapLands(cost)(g);
      return { ...after, hand: after.hand.filter((c) => c.uid !== uid),
        battlefield: [...after.battlefield, { ...card, tapped: false, summoningSick: card.isCreature, enteredTurn: g.turn }] };
    });
  }
  function castCommander() {
    if (!game.commandZone) return;
    const cost = Math.ceil(deck.commander.cmc);
    if (cost > availableMana) return;
    setGame((g) => {
      const after = autoTapLands(cost)(g);
      const cmd: BfCard = {
        uid: "commander",
        oracle_id: deck.commander.oracle_id,
        name: deck.commander.name,
        mana_cost: deck.commander.mana_cost,
        cmc: deck.commander.cmc,
        type_line: deck.commander.type_line,
        isLand: false,
        isCreature: /\bCreature\b/i.test(deck.commander.type_line),
        etbTapped: false,
        tapped: false,
        summoningSick: /\bCreature\b/i.test(deck.commander.type_line),
        enteredTurn: g.turn,
      };
      return { ...after, battlefield: [...after.battlefield, cmd], commandZone: false };
    });
  }
  function returnCommanderToZone() {
    setGame((g) => ({
      ...g,
      battlefield: g.battlefield.filter((c) => c.uid !== "commander"),
      commandZone: true,
    }));
  }
  function toGraveyard(uid: string, from: "battlefield" | "hand") {
    if (uid === "commander") { returnCommanderToZone(); return; }
    setGame((g) => {
      const src = from === "battlefield" ? g.battlefield : g.hand;
      const card = src.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, [from]: src.filter((c) => c.uid !== uid), graveyard: [...g.graveyard, card] };
    });
  }
  function toExile(uid: string, from: "graveyard" | "exile") {
    setGame((g) => {
      const card = g[from].find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, [from]: g[from].filter((c) => c.uid !== uid), exile: [...g.exile, card] };
    });
  }
  function zoneToHand(uid: string, from: "graveyard" | "library") {
    setGame((g) => {
      const card = g[from].find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, [from]: g[from].filter((c) => c.uid !== uid), hand: [...g.hand, card] };
    });
  }
  function libToTop(uid: string) {
    setGame((g) => {
      const idx = g.library.findIndex((c) => c.uid === uid);
      if (idx < 0) return g;
      const card = g.library[idx];
      const rest = g.library.filter((c) => c.uid !== uid);
      return { ...g, library: [card, ...rest] };
    });
  }
  function libToBottom(uid: string) {
    setGame((g) => {
      const card = g.library.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, library: [...g.library.filter((c) => c.uid !== uid), card] };
    });
  }

  const toggleSidebar = (s: Sidebar) => setSidebar((prev) => prev === s ? null : s);

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
              {game.manaPool > 0 && <span className="text-amber-400"> ({game.manaPool} pool)</span>}
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

      {showStats && stats && (
        <div className="flex shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-900/50 px-4 py-1 text-xs text-slate-300">
          <span>Avg lands: <b>{stats.avgLands.toFixed(1)}</b></span>
          <span className="text-emerald-400">Keep: <b>{stats.keepablePct.toFixed(0)}%</b></span>
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
        {/* Battlefield */}
        <div className="flex flex-1 flex-col overflow-auto p-3">
          <div className="flex-1">
            {nonlandsInPlay.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-600">Permanents ({nonlandsInPlay.length})</div>
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
          {landsInPlay.length > 0 && (
            <div className="mt-auto pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">Lands ({untappedLands}/{landsInPlay.length})</div>
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
        <div className="flex w-20 shrink-0 flex-col items-center gap-2 border-l border-slate-800 bg-slate-900/30 p-2 pt-3">
          {/* Command zone */}
          <div className="flex flex-col items-center gap-1">
            <div className={"relative cursor-pointer " + (!game.commandZone ? "opacity-40" : "")}
              onClick={() => { if (game.commandZone && game.phase === "play") castCommander(); }}
              onMouseEnter={() => setHoveredCard(deck.commander.name)}
              onMouseLeave={() => setHoveredCard(null)}
              title={game.commandZone ? `Cast commander (${Math.ceil(deck.commander.cmc)})` : "On battlefield"}>
              <img src={cardImg(deck.commander.name)} alt={deck.commander.name} loading="lazy"
                className="h-[80px] w-[57px] rounded-lg border border-amber-700 object-contain bg-slate-900" />
              {game.commandZone && game.phase === "play" && availableMana >= Math.ceil(deck.commander.cmc) && (
                <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-amber-600/90 text-center text-[8px] font-bold text-white">
                  Cast ({Math.ceil(deck.commander.cmc)})
                </div>
              )}
            </div>
            <span className="text-[10px] text-amber-500">Commander</span>
          </div>

          <div className="my-1 w-full border-t border-slate-800" />

          <ZonePile cards={game.library} label="Library" faceDown onClick={() => toggleSidebar("library")} />
          <ZonePile cards={game.graveyard} label="Graveyard" onClick={() => toggleSidebar("graveyard")} />
          <ZonePile cards={game.exile} label="Exile" onClick={() => toggleSidebar("exile")} />

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
          {game.phase === "bottoming" && <span className="text-[10px] text-amber-400">Select {cardsToBottom} to bottom</span>}
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
                onClick={() => { if (game.phase === "bottoming") toggleBottom(c.uid); else if (canPlay) playCard(c.uid); }}
                onRightClick={game.phase === "play" ? () => toGraveyard(c.uid, "hand") : undefined}
                onHover={() => setHoveredCard(c.name)} onLeave={() => setHoveredCard(null)} />
            );
          })}
          {game.hand.length === 0 && game.phase === "play" && <span className="py-6 text-sm text-slate-600">Empty hand</span>}
        </div>
      </div>

      {/* Zone browser sidebars */}
      {sidebar === "library" && (
        <ZoneBrowser title="Library" cards={game.library} onClose={() => setSidebar(null)}
          onHover={setHoveredCard} onLeave={() => setHoveredCard(null)}
          actions={(c) => [
            { label: "Hand", onClick: () => zoneToHand(c.uid, "library") },
            { label: "Top", onClick: () => libToTop(c.uid) },
            { label: "Bottom", onClick: () => libToBottom(c.uid) },
          ]} />
      )}
      {sidebar === "graveyard" && (
        <ZoneBrowser title="Graveyard" cards={game.graveyard} onClose={() => setSidebar(null)}
          onHover={setHoveredCard} onLeave={() => setHoveredCard(null)}
          actions={(c) => [
            { label: "Hand", onClick: () => zoneToHand(c.uid, "graveyard") },
            { label: "Exile", onClick: () => toExile(c.uid, "graveyard") },
          ]} />
      )}
      {sidebar === "exile" && (
        <ZoneBrowser title="Exile" cards={game.exile} onClose={() => setSidebar(null)}
          onHover={setHoveredCard} onLeave={() => setHoveredCard(null)}
          actions={() => []} />
      )}

      {/* Hover zoom */}
      {hoveredCard && !sidebar && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <img src={scryfallNamedImageUrl(hoveredCard, "large")} alt={hoveredCard}
            className="h-[480px] w-[344px] rounded-2xl border-2 border-slate-600 object-contain shadow-2xl shadow-black/80" />
        </div>
      )}
    </div>
  );
}
