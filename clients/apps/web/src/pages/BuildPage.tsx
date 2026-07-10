import { useState } from "react";
import type { CommanderOption, GeneratedDeck, PoolResponse } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import CommanderPicker from "../components/CommanderPicker";
import DeckView from "../components/DeckView";
import ManaCurve from "../components/ManaCurve";
import PoolTable from "../components/PoolTable";
import StatTile from "../components/StatTile";

export default function BuildPage() {
  const { summary, refreshSaved } = useLayout();
  const [pool, setPool] = useState<PoolResponse | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);
  const [deck, setDeck] = useState<GeneratedDeck | null>(null);
  const [buildingDeck, setBuildingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);

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

  if (summary && !summary.has_collection) {
    return (
      <p className="text-slate-400">
        Import your collection first — head to the Collection tab to get started.
      </p>
    );
  }

  return (
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
                Color identity {formatColorIdentity(pool.color_identity)} · {pool.commander.type_line}
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
            <DeckView deck={deck} onSaved={refreshSaved} />
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
  );
}
