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
  commandZone: boolean;
  turn: number;
  mulligans: number;
  phase: Phase;
  manaPool: number;
}

function freshGame(lib: LibCard[]): Game {
  const shuffled = shuffle(lib);
  return {
    library: shuffled.slice(7), hand: shuffled.slice(0, 7),
    battlefield: [], graveyard: [], exile: [],
    commandZone: true, turn: 0, mulligans: 0, phase: "mulligan", manaPool: 0,
  };
}

// Build a name→CDN URL map from deck card data (server-provided image_uris).
// Falls back to Scryfall named API for cards without URLs.
function buildImageMap(deck: GeneratedDeck): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of deck.cards) {
    if (c.image_uris?.normal) m.set(c.name, c.image_uris.normal);
  }
  if (deck.commander?.image_uris?.normal) m.set(deck.commander.name, deck.commander.image_uris.normal);
  return m;
}

function makeCardImg(imageMap: Map<string, string>) {
  return (name: string): string => imageMap.get(name) ?? scryfallNamedImageUrl(name, "normal");
}

// Selected card + its zone, for the action popup
type Selection = { uid: string; zone: "hand" | "battlefield" | "command" } | null;

function PlayCard({
  card, tapped, sick, highlight, onClick, onHover, onLeave, tall = false,
  dragData, cardImg,
}: {
  card: LibCard; tapped?: boolean; sick?: boolean; highlight?: boolean;
  onClick?: () => void; onHover?: () => void; onLeave?: () => void; tall?: boolean;
  dragData?: string; // JSON-encoded {uid, zone} for drag transfer
  cardImg: (name: string) => string;
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
        (highlight ? "ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-950 rounded-lg " : "") +
        (onClick ? "hover:-translate-y-1 " : "")
      }
      draggable={!!dragData}
      onDragStart={(e) => { if (dragData) { e.dataTransfer.setData("text/plain", dragData); e.dataTransfer.effectAllowed = "move"; } }}
      onClick={onClick} onMouseEnter={onHover} onMouseLeave={onLeave}
    >
      <img src={cardImg(card.name)} alt={card.name} loading="lazy" draggable={false}
        className={`${imgClass} rounded-lg border border-slate-600 object-contain bg-slate-900`} />
      {sick && (
        <div className="absolute top-0 left-0 right-0 rounded-t-lg bg-black/80 px-1 py-0.5 text-center text-[9px] font-medium text-amber-400">
          Sick
        </div>
      )}
    </div>
  );
}

// Drop zone wrapper — highlights on drag over
function DropZone({ zone, onDrop, children, className = "" }: {
  zone: string;
  onDrop: (uid: string, fromZone: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={className + (over ? " ring-2 ring-sky-400/50 ring-inset rounded-lg" : "")}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        try {
          const { uid, zone: fromZone } = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (fromZone !== zone) onDrop(uid, fromZone);
        } catch { /* ignore bad data */ }
      }}
    >
      {children}
    </div>
  );
}

function ZonePile({ cards, label, onClick, faceDown, cardImg }: {
  cards: LibCard[]; label: string; onClick?: () => void; faceDown?: boolean;
  cardImg: (name: string) => string;
}) {
  const empty = cards.length === 0;
  return (
    <div className="flex flex-col items-center gap-1 cursor-pointer" onClick={onClick}
      title={`${label}: ${cards.length}`}>
      <div className="relative">
        {empty ? (
          <div className="flex h-[80px] w-[57px] items-center justify-center rounded-lg border border-dashed border-slate-700 text-[9px] text-slate-700">{label}</div>
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

function ZoneBrowser({ title, cards, onClose, actions, onHover, onLeave, extraButton, cardImg }: {
  title: string; cards: LibCard[]; onClose: () => void;
  actions: (card: LibCard, idx: number) => { label: string; onClick: () => void }[];
  onHover: (name: string) => void; onLeave: () => void;
  extraButton?: { label: string; onClick: () => void };
  cardImg: (name: string) => string;
}) {
  return (
    <div className="absolute inset-0 z-10 overflow-auto bg-slate-950 p-3 shadow-xl sm:inset-auto sm:bottom-0 sm:right-20 sm:top-10 sm:w-72 sm:border-l sm:border-slate-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-300">{title} ({cards.length})</span>
        <div className="flex items-center gap-2">
          {extraButton && (
            <button onClick={extraButton.onClick}
              className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700">{extraButton.label}</button>
          )}
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
        </div>
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
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700">{a.label}</button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Card preview + action buttons: shows when a card is selected
function CardActionOverlay({ cardName, actions, onClose, cardImg }: {
  cardName: string;
  actions: { label: string; color: string; onClick: () => void }[];
  onClose: () => void;
  cardImg: (name: string) => string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img src={cardImg(cardName)} alt={cardName}
          className="h-[420px] w-[300px] rounded-2xl border-2 border-slate-600 object-contain shadow-2xl" />
        <div className="flex flex-wrap justify-center gap-2">
          {actions.map((a) => (
            <button key={a.label} onClick={() => { a.onClick(); onClose(); }}
              className={`rounded-lg px-5 py-2 text-sm font-medium shadow transition hover:opacity-80 ${a.color}`}>
              {a.label}
            </button>
          ))}
          <button onClick={onClose} className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-300 shadow hover:bg-slate-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type Sidebar = "library" | "graveyard" | "exile" | null;
const MAX_UNDO = 50;

export default function PlaytestModal({ deck, onClose }: { deck: GeneratedDeck; onClose: () => void }) {
  const imageMap = useMemo(() => buildImageMap(deck), [deck]);
  const cardImg = useMemo(() => makeCardImg(imageMap), [imageMap]);
  const library0 = useMemo(() => buildLibrary(deck.cards), [deck]);
  const [game, setGameRaw] = useState<Game>(() => freshGame(library0));
  const [history, setHistory] = useState<Game[]>([]);
  const [toBottom, setToBottom] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<OpenerStats | null>(() => sampleOpenerStats(deck.cards, 1000));
  const [showStats, setShowStats] = useState(true);
  const [sidebar, setSidebar] = useState<Sidebar>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>(null);

  function setGame(updater: Game | ((g: Game) => Game)) {
    setGameRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next === prev) return prev;
      setHistory((h) => [...h.slice(-(MAX_UNDO - 1)), prev]);
      return next;
    });
  }
  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      setGameRaw(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }

  const landsInPlay = game.battlefield.filter((c) => c.isLand);
  const nonlandsInPlay = game.battlefield.filter((c) => !c.isLand);
  const untappedLands = landsInPlay.filter((c) => !c.tapped).length;
  const availableMana = game.manaPool + untappedLands;
  const mulliganHandSize = game.mulligans <= 0 ? 7 : Math.max(1, 8 - game.mulligans);
  const cardsToBottom = 7 - mulliganHandSize;

  // --- Actions (no restrictions — user manages rules) ---

  function endTurn() {
    setGame((g) => {
      const bf = g.battlefield.map((c) => ({ ...c, tapped: false, summoningSick: false }));
      const newTurn = g.turn + 1;
      if (g.library.length === 0) return { ...g, battlefield: bf, turn: newTurn, manaPool: 0 };
      const [drawn, ...rest] = g.library;
      return { ...g, hand: [...g.hand, drawn], library: rest, battlefield: bf, turn: newTurn, manaPool: 0 };
    });
  }

  const untapAll = useCallback(() => {
    setGame((g) => ({ ...g, battlefield: g.battlefield.map((c) => ({ ...c, tapped: false })), manaPool: 0 }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function shuffleLibrary() {
    setGame((g) => ({ ...g, library: shuffle(g.library) }));
    setSidebar(null);
  }

  // Move card from hand to battlefield (cast/play)
  function handToBattlefield(uid: string) {
    setGame((g) => {
      const card = g.hand.find((c) => c.uid === uid);
      if (!card) return g;
      return {
        ...g, hand: g.hand.filter((c) => c.uid !== uid),
        battlefield: [...g.battlefield, {
          ...card, tapped: false,
          summoningSick: card.isCreature,
          enteredTurn: g.turn,
        }],
      };
    });
  }
  function handToGraveyard(uid: string) {
    setGame((g) => {
      const card = g.hand.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, hand: g.hand.filter((c) => c.uid !== uid), graveyard: [...g.graveyard, card] };
    });
  }
  function handToExile(uid: string) {
    setGame((g) => {
      const card = g.hand.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, hand: g.hand.filter((c) => c.uid !== uid), exile: [...g.exile, card] };
    });
  }

  function bfTapToggle(uid: string) {
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
  function bfToGraveyard(uid: string) {
    if (uid === "commander") { setGame((g) => ({ ...g, battlefield: g.battlefield.filter((c) => c.uid !== uid), commandZone: true })); return; }
    setGame((g) => {
      const card = g.battlefield.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, battlefield: g.battlefield.filter((c) => c.uid !== uid), graveyard: [...g.graveyard, card] };
    });
  }
  function bfToExile(uid: string) {
    if (uid === "commander") { setGame((g) => ({ ...g, battlefield: g.battlefield.filter((c) => c.uid !== uid), commandZone: true })); return; }
    setGame((g) => {
      const card = g.battlefield.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, battlefield: g.battlefield.filter((c) => c.uid !== uid), exile: [...g.exile, card] };
    });
  }
  function bfToHand(uid: string) {
    if (uid === "commander") { setGame((g) => ({ ...g, battlefield: g.battlefield.filter((c) => c.uid !== uid), commandZone: true })); return; }
    setGame((g) => {
      const card = g.battlefield.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, battlefield: g.battlefield.filter((c) => c.uid !== uid), hand: [...g.hand, card] };
    });
  }

  function castCommander() {
    const commander = deck.commander;
    if (!game.commandZone || !commander) return;
    setGame((g) => {
      const isCre = /\bCreature\b/i.test(commander.type_line);
      const cmd: BfCard = {
        uid: "commander", oracle_id: commander.oracle_id, name: commander.name,
        mana_cost: commander.mana_cost, cmc: commander.cmc, type_line: commander.type_line,
        isLand: false, isCreature: isCre, etbTapped: false, tapped: false, summoningSick: isCre, enteredTurn: g.turn,
      };
      return { ...g, battlefield: [...g.battlefield, cmd], commandZone: false };
    });
  }

  function zoneToHand(uid: string, from: "graveyard" | "library") {
    setGame((g) => {
      const card = g[from].find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, [from]: g[from].filter((c) => c.uid !== uid), hand: [...g.hand, card] };
    });
  }
  function zoneToBattlefield(uid: string, from: "graveyard" | "library" | "exile") {
    setGame((g) => {
      const card = g[from].find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, [from]: g[from].filter((c) => c.uid !== uid),
        battlefield: [...g.battlefield, { ...card, tapped: false, summoningSick: card.isCreature, enteredTurn: g.turn }] };
    });
  }
  function gyToExile(uid: string) {
    setGame((g) => {
      const card = g.graveyard.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, graveyard: g.graveyard.filter((c) => c.uid !== uid), exile: [...g.exile, card] };
    });
  }
  function libToTop(uid: string) {
    setGame((g) => {
      const card = g.library.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, library: [card, ...g.library.filter((c) => c.uid !== uid)] };
    });
  }
  function libToBottom(uid: string) {
    setGame((g) => {
      const card = g.library.find((c) => c.uid === uid);
      if (!card) return g;
      return { ...g, library: [...g.library.filter((c) => c.uid !== uid), card] };
    });
  }

  // --- Mulligan ---
  function newGame() { setGameRaw(freshGame(library0)); setHistory([]); setToBottom(new Set()); setSidebar(null); setSelected(null); }
  function mulligan() {
    setGame((g) => { const s = shuffle(library0); return { ...freshGame(library0), library: s.slice(7), hand: s.slice(0, 7), mulligans: g.mulligans + 1 }; });
    setToBottom(new Set());
  }
  function keep() { setGame((g) => cardsToBottom > 0 ? { ...g, phase: "bottoming" } : { ...g, phase: "play", turn: 1 }); }
  function toggleBottom(uid: string) {
    setToBottom((prev) => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else if (n.size < cardsToBottom) n.add(uid); return n; });
  }
  function confirmBottom() {
    setGame((g) => ({ ...g, hand: g.hand.filter((c) => !toBottom.has(c.uid)), library: [...g.library, ...g.hand.filter((c) => toBottom.has(c.uid))], phase: "play", turn: 1 }));
    setToBottom(new Set());
  }

  // --- Keyboard ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { if (selected) setSelected(null); else if (sidebar) setSidebar(null); else onClose(); }
      if (e.key === "d" && game.phase === "play") endTurn();
      if (e.key === "u" && game.phase === "play") untapAll();
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, game.phase, untapAll, sidebar, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generic move: drag a card from any zone to any zone
  function moveCard(uid: string, fromZone: string, toZone: string) {
    if (fromZone === toZone) return;
    if (uid === "commander") {
      if (toZone === "battlefield") castCommander();
      else if (toZone === "command") { /* already there or returning */ }
      else setGame((g) => ({ ...g, battlefield: g.battlefield.filter((c) => c.uid !== uid), commandZone: true }));
      return;
    }
    setGame((g) => {
      const src = fromZone === "hand" ? g.hand : fromZone === "battlefield" ? g.battlefield : fromZone === "graveyard" ? g.graveyard : fromZone === "exile" ? g.exile : g.library;
      const card = src.find((c) => c.uid === uid);
      if (!card) return g;
      const without = (arr: any[]) => arr.filter((c: any) => c.uid !== uid);
      const next: any = { ...g };
      // Remove from source
      if (fromZone === "hand") next.hand = without(g.hand);
      else if (fromZone === "battlefield") next.battlefield = without(g.battlefield);
      else if (fromZone === "graveyard") next.graveyard = without(g.graveyard);
      else if (fromZone === "exile") next.exile = without(g.exile);
      else if (fromZone === "library") next.library = without(g.library);
      // Add to destination
      if (toZone === "hand") next.hand = [...(next.hand ?? g.hand), card];
      else if (toZone === "battlefield") next.battlefield = [...(next.battlefield ?? g.battlefield), { ...card, tapped: false, summoningSick: card.isCreature, enteredTurn: g.turn }];
      else if (toZone === "graveyard") next.graveyard = [...(next.graveyard ?? g.graveyard), card];
      else if (toZone === "exile") next.exile = [...(next.exile ?? g.exile), card];
      return next;
    });
  }

  const toggleSidebar = (s: Sidebar) => setSidebar((prev) => prev === s ? null : s);

  // Get selected card name for the overlay
  function selectedCardName(): string | null {
    if (!selected) return null;
    if (selected.zone === "command") return deck.commander?.name ?? null;
    const zone = selected.zone === "hand" ? game.hand : game.battlefield;
    return zone.find((c) => c.uid === selected.uid)?.name ?? null;
  }

  function selectedActions(): { label: string; color: string; onClick: () => void }[] {
    if (!selected) return [];
    const { uid, zone } = selected;
    if (zone === "hand") return [
      { label: "Play / Cast", color: "bg-emerald-600 text-white", onClick: () => handToBattlefield(uid) },
      { label: "Discard", color: "bg-rose-600 text-white", onClick: () => handToGraveyard(uid) },
      { label: "Exile", color: "bg-violet-600 text-white", onClick: () => handToExile(uid) },
    ];
    if (zone === "battlefield") return [
      { label: "Tap / Untap", color: "bg-sky-600 text-white", onClick: () => bfTapToggle(uid) },
      { label: "Sacrifice", color: "bg-rose-600 text-white", onClick: () => bfToGraveyard(uid) },
      { label: "Exile", color: "bg-violet-600 text-white", onClick: () => bfToExile(uid) },
      { label: "Return to hand", color: "bg-slate-700 text-white", onClick: () => bfToHand(uid) },
    ];
    if (zone === "command") return [
      { label: "Cast commander", color: "bg-amber-600 text-white", onClick: () => castCommander() },
    ];
    return [];
  }

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-slate-950">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2 sm:gap-4">
          <h2 className="text-xs font-semibold text-slate-100 sm:text-sm">
            {deck.commander?.name ?? `${deck.format.charAt(0).toUpperCase()}${deck.format.slice(1)} deck`}
          </h2>
          <div className="flex items-center gap-2 text-[10px] text-slate-400 sm:gap-3 sm:text-xs">
            <span>T<b className="text-slate-200">{game.phase === "play" ? game.turn : "—"}</b></span>
            <span>Lib <b className="text-slate-300">{game.library.length}</b></span>
            <span>Mana <b className="text-emerald-400">{availableMana}</b></span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
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
              <button onClick={endTurn} className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500">End turn (D)</button>
              <button onClick={untapAll} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">Untap (U)</button>
            </>
          )}
          <button onClick={undo} disabled={history.length === 0}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-30" title="Ctrl+Z">Undo</button>
          <button onClick={shuffleLibrary} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">Shuffle</button>
          <button onClick={newGame} className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">New</button>
          <button onClick={() => setShowStats((s) => !s)}
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">{showStats ? "Hide stats" : "Stats"}</button>
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
        <DropZone zone="battlefield" onDrop={(uid, from) => moveCard(uid, from, "battlefield")}
          className="flex flex-1 flex-col overflow-auto p-3">
          <div className="flex-1">
            {nonlandsInPlay.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-600">Permanents ({nonlandsInPlay.length})</div>
                <div className="flex flex-wrap items-start gap-3">
                  {nonlandsInPlay.map((c) => (
                    <PlayCard key={c.uid} card={c} tapped={c.tapped} sick={c.summoningSick} tall
                      highlight={selected?.uid === c.uid}
                      dragData={JSON.stringify({ uid: c.uid, zone: "battlefield" })}
                      onClick={() => setSelected(selected?.uid === c.uid ? null : { uid: c.uid, zone: "battlefield" })}
                      onHover={() => setHoveredCard(c.name)} onLeave={() => setHoveredCard(null)} cardImg={cardImg} />
                  ))}
                </div>
              </div>
            )}
            {game.phase === "play" && game.battlefield.length === 0 && (
              <div className="flex h-full items-center justify-center text-sm text-slate-700">
                Click a card for actions, or drag it between zones
              </div>
            )}
          </div>
          {landsInPlay.length > 0 && (
            <div className="mt-auto pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">Lands ({untappedLands}/{landsInPlay.length})</div>
              <div className="flex flex-wrap items-start gap-1.5">
                {landsInPlay.map((c) => (
                  <PlayCard key={c.uid} card={c} tapped={c.tapped}
                    highlight={selected?.uid === c.uid}
                    dragData={JSON.stringify({ uid: c.uid, zone: "battlefield" })}
                    onClick={() => setSelected(selected?.uid === c.uid ? null : { uid: c.uid, zone: "battlefield" })}
                    onHover={() => setHoveredCard(c.name)} onLeave={() => setHoveredCard(null)} cardImg={cardImg} />
                ))}
              </div>
            </div>
          )}
        </DropZone>

        {/* Side zones */}
        <div className="flex w-20 shrink-0 flex-col items-center gap-2 border-l border-slate-800 bg-slate-900/30 p-2 pt-3">
          {/* Command zone exists only in Commander. */}
          {deck.commander && (
            <>
              <div className="flex flex-col items-center gap-1">
                <div className={"relative cursor-pointer " + (!game.commandZone ? "opacity-40" : "")}
                  onClick={() => { if (game.commandZone) setSelected(selected?.zone === "command" ? null : { uid: "commander", zone: "command" }); }}
                  onMouseEnter={() => setHoveredCard(deck.commander!.name)} onMouseLeave={() => setHoveredCard(null)}>
                  <img src={cardImg(deck.commander.name)} alt={deck.commander.name} loading="lazy"
                    className={"h-[80px] w-[57px] rounded-lg border object-contain bg-slate-900 " +
                      (selected?.zone === "command" ? "border-sky-400" : "border-amber-700")} />
                </div>
                <span className="text-[10px] text-amber-500">Commander</span>
              </div>
              <div className="my-1 w-full border-t border-slate-800" />
            </>
          )}
          <ZonePile cards={game.library} label="Library" faceDown onClick={() => toggleSidebar("library")} cardImg={cardImg} />
          <DropZone zone="graveyard" onDrop={(uid, from) => moveCard(uid, from, "graveyard")}>
            <ZonePile cards={game.graveyard} label="Graveyard" onClick={() => toggleSidebar("graveyard")} cardImg={cardImg} />
          </DropZone>
          <DropZone zone="exile" onDrop={(uid, from) => moveCard(uid, from, "exile")}>
            <ZonePile cards={game.exile} label="Exile" onClick={() => toggleSidebar("exile")} cardImg={cardImg} />
          </DropZone>
        </div>
      </div>

      {/* Hand */}
      <DropZone zone="hand" onDrop={(uid, from) => moveCard(uid, from, "hand")}
        className="shrink-0 border-t border-slate-800 bg-slate-900/60 px-3 py-2">
        <div className="mb-1 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Hand ({game.hand.length})</span>
          {game.phase === "bottoming" && <span className="text-[10px] text-amber-400">Select {cardsToBottom} to bottom</span>}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {game.hand.map((c) => {
            const sel = toBottom.has(c.uid);
            return (
              <PlayCard key={c.uid} card={c} highlight={selected?.uid === c.uid || sel} tall
                dragData={game.phase === "play" ? JSON.stringify({ uid: c.uid, zone: "hand" }) : undefined}
                onClick={() => {
                  if (game.phase === "bottoming") toggleBottom(c.uid);
                  else setSelected(selected?.uid === c.uid ? null : { uid: c.uid, zone: "hand" });
                }}
                onHover={() => setHoveredCard(c.name)} onLeave={() => setHoveredCard(null)} cardImg={cardImg} />
            );
          })}
          {game.hand.length === 0 && game.phase === "play" && <span className="py-6 text-sm text-slate-600">Empty hand</span>}
        </div>
      </DropZone>

      {/* Card action overlay: large preview + buttons */}
      {selected && game.phase === "play" && selectedCardName() && (
        <CardActionOverlay cardName={selectedCardName()!} actions={selectedActions()} onClose={() => setSelected(null)} cardImg={cardImg} />
      )}

      {/* Zone browsers */}
      {sidebar === "library" && (
        <ZoneBrowser title="Library" cards={game.library} onClose={() => setSidebar(null)}
          onHover={setHoveredCard} onLeave={() => setHoveredCard(null)}
          extraButton={{ label: "Shuffle", onClick: shuffleLibrary }}
          cardImg={cardImg}
          actions={(c) => [
            { label: "Hand", onClick: () => zoneToHand(c.uid, "library") },
            { label: "Play", onClick: () => zoneToBattlefield(c.uid, "library") },
            { label: "Top", onClick: () => libToTop(c.uid) },
            { label: "Bottom", onClick: () => libToBottom(c.uid) },
          ]} />
      )}
      {sidebar === "graveyard" && (
        <ZoneBrowser title="Graveyard" cards={game.graveyard} onClose={() => setSidebar(null)}
          onHover={setHoveredCard} onLeave={() => setHoveredCard(null)}
          cardImg={cardImg}
          actions={(c) => [
            { label: "Hand", onClick: () => zoneToHand(c.uid, "graveyard") },
            { label: "Play", onClick: () => zoneToBattlefield(c.uid, "graveyard") },
            { label: "Exile", onClick: () => gyToExile(c.uid) },
          ]} />
      )}
      {sidebar === "exile" && (
        <ZoneBrowser title="Exile" cards={game.exile} onClose={() => setSidebar(null)}
          onHover={setHoveredCard} onLeave={() => setHoveredCard(null)}
          cardImg={cardImg}
          actions={(c) => [
            { label: "Hand", onClick: () => { setGame((g) => { const card = g.exile.find((x) => x.uid === c.uid); if (!card) return g; return { ...g, exile: g.exile.filter((x) => x.uid !== c.uid), hand: [...g.hand, card] }; }); } },
            { label: "Play", onClick: () => zoneToBattlefield(c.uid, "exile") },
          ]} />
      )}

      {/* Hover zoom — shows when hovering, hidden when action overlay or sidebar is open */}
      {hoveredCard && !sidebar && !selected && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center">
          <img src={cardImg(hoveredCard)} alt={hoveredCard}
            className="h-[480px] w-[344px] rounded-2xl border-2 border-slate-600 object-contain shadow-2xl shadow-black/80" />
        </div>
      )}
    </div>
  );
}
