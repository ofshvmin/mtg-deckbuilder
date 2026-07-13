import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { DeckCard, GeneratedDeck, SavedDeck } from "@mtg/shared";
import { api } from "../lib/api";
import { formatColorIdentity } from "../lib/format";
import type { Color } from "@mtg/shared";
import ManaCurve from "../components/ManaCurve";

const SLOT_LABELS: Record<string, string> = {
  land: "Lands",
  ramp: "Ramp",
  card_draw: "Card Draw",
  removal: "Removal",
  board_wipe: "Board Wipes",
  game_plan: "Game Plan",
};

const SLOT_ORDER = ["land", "ramp", "card_draw", "removal", "board_wipe", "game_plan"];

export default function ComparePage() {
  const [params] = useSearchParams();
  const idA = params.get("a");
  const idB = params.get("b");
  const [deckA, setDeckA] = useState<SavedDeck | null>(null);
  const [deckB, setDeckB] = useState<SavedDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idA || !idB) {
      setError("Two deck IDs are required.");
      setLoading(false);
      return;
    }
    Promise.all([api.getSavedDeck(idA), api.getSavedDeck(idB)])
      .then(([a, b]) => {
        setDeckA(a);
        setDeckB(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load decks"))
      .finally(() => setLoading(false));
  }, [idA, idB]);

  if (loading) {
    return <p className="text-slate-400">Loading decks…</p>;
  }

  if (error || !deckA || !deckB) {
    return (
      <div className="space-y-4">
        <p className="text-rose-400">{error || "Could not load one or both decks."}</p>
        <Link to="/decks" className="text-sm text-indigo-400 hover:underline">← Back to Decks</Link>
      </div>
    );
  }

  const comparison = compareDeckCards(deckA.deck, deckB.deck);

  return (
    <div className="space-y-6">
      <Link to="/decks" className="inline-block text-sm text-slate-400 hover:text-slate-200">← Back to Decks</Link>

      {/* Deck headers */}
      <div className="grid grid-cols-2 gap-4">
        <DeckHeader name={deckA.name} deck={deckA.deck} />
        <DeckHeader name={deckB.name} deck={deckB.deck} />
      </div>

      {/* Stats comparison */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatComparison label="Total" a={deckA.deck.total} b={deckB.deck.total} />
        <StatComparison label="Lands" a={deckA.deck.land_count} b={deckB.deck.land_count} />
        <StatComparison
          label="Avg MV"
          a={deckA.deck.stats.avg_nonland_mv ?? 0}
          b={deckB.deck.stats.avg_nonland_mv ?? 0}
          decimal
        />
        <StatComparison
          label="Bracket"
          a={deckA.deck.bracket?.bracket ?? 0}
          b={deckB.deck.bracket?.bracket ?? 0}
        />
      </div>

      {/* Side-by-side mana curves */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Mana Curve — {deckA.name}</h4>
          <ManaCurve curve={deckA.deck.curve} />
        </div>
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Mana Curve — {deckB.name}</h4>
          <ManaCurve curve={deckB.deck.curve} />
        </div>
      </div>

      {/* Shared cards */}
      {comparison.shared.length > 0 && (
        <section>
          <h3 className="mb-3 text-lg font-semibold text-slate-200">
            Shared Cards ({comparison.shared.length})
          </h3>
          <GroupedCards cards={comparison.shared} />
        </section>
      )}

      {/* Unique to each */}
      <div className="grid gap-6 lg:grid-cols-2">
        {comparison.onlyA.length > 0 && (
          <section>
            <h3 className="mb-3 text-lg font-semibold text-slate-200">
              Only in {deckA.name} ({comparison.onlyA.length})
            </h3>
            <GroupedCards cards={comparison.onlyA} />
          </section>
        )}
        {comparison.onlyB.length > 0 && (
          <section>
            <h3 className="mb-3 text-lg font-semibold text-slate-200">
              Only in {deckB.name} ({comparison.onlyB.length})
            </h3>
            <GroupedCards cards={comparison.onlyB} />
          </section>
        )}
      </div>
    </div>
  );
}

function DeckHeader({ name, deck }: { name: string; deck: GeneratedDeck }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="truncate text-lg font-semibold text-white">{name}</h3>
      <p className="mt-1 text-sm text-slate-400">
        {deck.commander.name} · {formatColorIdentity(deck.color_identity as Color[])}
      </p>
    </div>
  );
}

function StatComparison({
  label,
  a,
  b,
  decimal,
}: {
  label: string;
  a: number;
  b: number;
  decimal?: boolean;
}) {
  const fmt = (v: number) => (decimal ? v.toFixed(2) : String(v));
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 flex items-center justify-center gap-3 text-lg font-bold tabular-nums">
        <span className="text-sky-400">{fmt(a)}</span>
        <span className="text-xs text-slate-600">vs</span>
        <span className="text-amber-400">{fmt(b)}</span>
      </div>
    </div>
  );
}

interface ComparedCard {
  oracle_id: string;
  name: string;
  slot: string;
  countA?: number;
  countB?: number;
}

function compareDeckCards(a: GeneratedDeck, b: GeneratedDeck) {
  const mapA = new Map<string, DeckCard>();
  for (const c of a.cards) mapA.set(c.oracle_id, c);
  const mapB = new Map<string, DeckCard>();
  for (const c of b.cards) mapB.set(c.oracle_id, c);

  const shared: ComparedCard[] = [];
  const onlyA: ComparedCard[] = [];
  const onlyB: ComparedCard[] = [];

  for (const [id, card] of mapA) {
    if (mapB.has(id)) {
      shared.push({
        oracle_id: id,
        name: card.name,
        slot: card.slot,
        countA: card.count,
        countB: mapB.get(id)!.count,
      });
    } else {
      onlyA.push({ oracle_id: id, name: card.name, slot: card.slot, countA: card.count });
    }
  }
  for (const [id, card] of mapB) {
    if (!mapA.has(id)) {
      onlyB.push({ oracle_id: id, name: card.name, slot: card.slot, countB: card.count });
    }
  }

  return { shared, onlyA, onlyB };
}

function GroupedCards({ cards }: { cards: ComparedCard[] }) {
  const groups = new Map<string, ComparedCard[]>();
  for (const c of cards) {
    const list = groups.get(c.slot) || [];
    list.push(c);
    groups.set(c.slot, list);
  }

  return (
    <div className="space-y-3">
      {SLOT_ORDER.filter((s) => groups.has(s)).map((slot) => {
        const items = groups.get(slot)!;
        items.sort((a, b) => a.name.localeCompare(b.name));
        return (
          <div key={slot} className="rounded-lg border border-slate-800 bg-slate-900/60">
            <div className="border-b border-slate-800 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">
              {SLOT_LABELS[slot] || slot} ({items.length})
            </div>
            <ul className="divide-y divide-slate-800/40">
              {items.map((c) => (
                <li key={c.oracle_id} className="flex items-center gap-2 px-3 py-1 text-sm text-slate-300">
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.countA != null && c.countB != null && c.countA !== c.countB && (
                    <span className="text-xs text-slate-500">
                      {c.countA}× / {c.countB}×
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
