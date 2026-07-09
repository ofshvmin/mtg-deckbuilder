import { useCallback, useEffect, useState } from "react";
import type {
  CollectionSummary,
  CommanderOption,
  GeneratedDeck,
  PoolResponse,
} from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { formatColorIdentity } from "../lib/format";
import CommanderPicker from "../components/CommanderPicker";
import DeckView from "../components/DeckView";
import ImportCollection from "../components/ImportCollection";
import ManaCurve from "../components/ManaCurve";
import PoolTable from "../components/PoolTable";
import StatTile from "../components/StatTile";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [pool, setPool] = useState<PoolResponse | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);
  const [deck, setDeck] = useState<GeneratedDeck | null>(null);
  const [buildingDeck, setBuildingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);

  const loadSummary = useCallback(() => {
    api.collectionSummary().then(setSummary).catch(() => setSummary(null));
  }, []);
  useEffect(loadSummary, [loadSummary]);

  async function selectCommander(c: CommanderOption) {
    setLoadingPool(true);
    setPoolError(null);
    setPool(null);
    setDeck(null);
    try {
      setPool(await api.getPool(c.name));
    } catch (e) {
      setPoolError(e instanceof Error ? e.message : "Could not load pool");
    } finally {
      setLoadingPool(false);
    }
  }

  async function buildDeck() {
    if (!pool) return;
    setBuildingDeck(true);
    setDeckError(null);
    try {
      setDeck(await api.generateDeck(pool.commander.name));
    } catch (e) {
      setDeckError(e instanceof Error ? e.message : "Could not build deck");
    } finally {
      setBuildingDeck(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight">MTG Deck Builder</h1>
          <div className="flex items-center gap-4 text-sm">
            {summary?.has_collection && (
              <span className="text-slate-400">
                {summary.unique_cards.toLocaleString()} unique ·{" "}
                {summary.total_cards.toLocaleString()} cards
              </span>
            )}
            <span className="text-slate-500">{user?.email}</span>
            <button
              onClick={() => logout()}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 transition hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {summary === null && <p className="text-slate-400">Loading…</p>}

        {summary && !summary.has_collection && (
          <div className="mx-auto max-w-xl">
            <ImportCollection onImported={loadSummary} />
          </div>
        )}

        {summary?.has_collection && (
          <div className="space-y-8">
            <div>
              <label className="text-sm font-medium text-slate-300">Commander</label>
              <div className="mt-2 max-w-lg">
                <CommanderPicker onSelect={selectCommander} />
              </div>
            </div>

            {loadingPool && <p className="text-slate-400">Building your legal pool…</p>}
            {poolError && <p className="text-rose-400">{poolError}</p>}

            {pool && (
              <div className="space-y-6">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold">{pool.commander.name}</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Color identity {formatColorIdentity(pool.color_identity)} ·{" "}
                      {pool.commander.type_line}
                    </p>
                  </div>
                  {deck ? (
                    <button
                      onClick={() => setDeck(null)}
                      className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                    >
                      ← Back to pool
                    </button>
                  ) : (
                    <button
                      onClick={buildDeck}
                      disabled={buildingDeck}
                      className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {buildingDeck ? "Building…" : "⚡ Build 99-card deck"}
                    </button>
                  )}
                </div>

                {deckError && <p className="text-rose-400">{deckError}</p>}

                {deck ? (
                  <DeckView deck={deck} />
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <StatTile label="Legal pool" value={pool.pool_size.toLocaleString()} />
                      <StatTile label="Lands" value={pool.land_count} />
                      <StatTile label="Nonlands" value={pool.pool_size - pool.land_count} />
                      <StatTile label="Colors" value={formatColorIdentity(pool.color_identity)} />
                    </div>
                    <ManaCurve curve={pool.curve} />
                    <PoolTable pool={pool.pool} />
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
