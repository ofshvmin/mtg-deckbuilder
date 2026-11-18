import { useMemo, useState } from "react";
import type { AnalysisResponse, AnalysisSwap, GeneratedDeck } from "@mtg/shared";
import { isPremiumRequired } from "@mtg/shared";
import { api } from "../lib/api";
import { usePremiumUpgrade } from "./PremiumUpgrade";
import ManaCost from "./ManaCost";

// Premium "Analyze & upgrade": a verdict on the deck plus cut-X/add-Y swaps,
// grouped by whether the new card is already in the collection. Applying the
// chosen swaps hands back a recomposed deck; the deck view marks it unsaved, so
// nothing changes until the player saves.

const money = (n: number) => `$${n.toFixed(2)}`;

export default function AnalyzePanel({
  deck,
  onApply,
}: {
  deck: GeneratedDeck;
  onApply: (next: GeneratedDeck) => void;
}) {
  const { showUpgrade } = usePremiumUpgrade();
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.analyzeDeck({
        commander: deck.commander?.name ?? null,
        format: deck.format,
        cards: deck.cards.map((c) => ({ oracle_id: c.oracle_id, count: c.count })),
        strategy: deck.strategy ?? null,
        ...(deck.format !== "commander" ? { colors: deck.colors } : {}),
      });
      setResult(res);
      // Pre-select everything from the collection: those swaps cost nothing.
      setPicked(new Set(res.swaps.flatMap((s, i) => (s.source === "owned" ? [i] : []))));
    } catch (e) {
      if (isPremiumRequired(e)) showUpgrade("Deck analysis");
      else setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      const counts = new Map(deck.cards.map((c) => [c.oracle_id, c.count]));
      result.swaps.forEach((s, i) => {
        if (!picked.has(i)) return;
        counts.set(s.cut.oracle_id, Math.max(0, (counts.get(s.cut.oracle_id) ?? 0) - s.cut.count));
        counts.set(s.add.oracle_id, (counts.get(s.add.oracle_id) ?? 0) + s.add.count);
      });
      const ids = [...counts].flatMap(([id, n]) => Array<string>(n).fill(id));
      const next = await api.composeDeck(deck.commander?.name ?? null, ids, deck.format, undefined, true);
      // Compose answers with the deck's shape; keep what it doesn't know.
      onApply({ ...next, strategy: deck.strategy, theme: deck.theme });
      setResult(null);
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the swaps");
    } finally {
      setApplying(false);
    }
  }

  const groups = useMemo(() => {
    const all = (result?.swaps ?? []).map((s, i) => ({ s, i }));
    return [
      { title: "From your collection", items: all.filter((x) => x.s.source === "owned") },
      { title: "To buy", items: all.filter((x) => x.s.source === "buy") },
    ].filter((g) => g.items.length > 0);
  }, [result]);

  const buyTotal = (result?.swaps ?? []).reduce(
    (sum, s, i) => sum + (picked.has(i) && s.source === "buy" ? (s.add.price_usd ?? 0) * s.add.count : 0),
    0,
  );

  function toggle(i: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-emerald-900/40 bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-medium text-slate-200">
          Analyze & upgrade <span className="text-amber-300">✦</span>{" "}
          <span className="font-normal text-slate-500">— what to cut, and what to add instead</span>
        </span>
        {!result && (
          <button
            onClick={analyze}
            disabled={loading}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {loading ? "Analyzing… (up to 30s)" : "Analyze deck"}
          </button>
        )}
      </div>

      {error && <p className="border-t border-emerald-900/30 px-4 py-3 text-sm text-rose-400">{error}</p>}

      {result && (
        <div className="space-y-4 border-t border-emerald-900/30 p-4">
          <p className="text-sm leading-6 text-slate-300">{result.verdict}</p>
          {!result.ai && (
            <p className="text-xs text-slate-500">
              Quick analysis — the AI review wasn't available, so these swaps come from card rank and
              the deck's needs alone.
            </p>
          )}

          {result.swaps.length === 0 && (
            <p className="text-sm text-slate-400">No clear upgrades found — this deck makes good use of what's available.</p>
          )}

          {groups.map((g) => (
            <div key={g.title}>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">{g.title}</h4>
              <ul className="divide-y divide-slate-800/60">
                {g.items.map(({ s, i }) => (
                  <SwapRow key={i} swap={s} checked={picked.has(i)} onToggle={() => toggle(i)} />
                ))}
              </ul>
            </div>
          ))}

          {result.swaps.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
              <span className="text-xs text-slate-400">
                {picked.size} selected
                {buyTotal > 0 && <> · about <span className="text-slate-200">{money(buyTotal)}</span> to buy</>}
                <span className="text-slate-600"> · prices approx., via Scryfall</span>
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setResult(null)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800"
                >
                  Dismiss
                </button>
                <button
                  onClick={apply}
                  disabled={picked.size === 0 || applying}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {applying ? "Applying…" : "Apply selected swaps"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SwapRow({ swap, checked, onToggle }: { swap: AnalysisSwap; checked: boolean; onToggle: () => void }) {
  const { cut, add } = swap;
  return (
    <li className="py-2">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 accent-emerald-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-rose-300/90">
              −{cut.count} {cut.name}
            </span>
            <span className="text-slate-600">→</span>
            <span className="text-emerald-300">
              +{add.count} {add.name}
            </span>
            <ManaCost cost={add.mana_cost} />
            {add.price_usd != null && (
              <span className="text-xs text-slate-400">{money(add.price_usd)}{add.count > 1 ? " ea" : ""}</span>
            )}
          </div>
          {swap.reason && <p className="mt-0.5 text-xs text-slate-500">{swap.reason}</p>}
        </div>
      </label>
    </li>
  );
}
