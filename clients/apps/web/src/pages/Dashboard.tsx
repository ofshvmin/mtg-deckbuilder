import { useCallback, useEffect, useState } from "react";
import type { CollectionSummary, CommanderOption, PoolResponse } from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { formatColorIdentity } from "../lib/format";
import CommanderPicker from "../components/CommanderPicker";
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

  const loadSummary = useCallback(() => {
    api.collectionSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  useEffect(loadSummary, [loadSummary]);

  async function selectCommander(c: CommanderOption) {
    setLoadingPool(true);
    setPoolError(null);
    setPool(null);
    try {
      setPool(await api.getPool(c.name));
    } catch (e) {
      setPoolError(e instanceof Error ? e.message : "Could not load pool");
    } finally {
      setLoadingPool(false);
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
                <div>
                  <h2 className="text-2xl font-semibold">{pool.commander.name}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Color identity {formatColorIdentity(pool.color_identity)} ·{" "}
                    {pool.commander.type_line}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <StatTile label="Legal pool" value={pool.pool_size.toLocaleString()} />
                  <StatTile label="Lands" value={pool.land_count} />
                  <StatTile label="Nonlands" value={pool.pool_size - pool.land_count} />
                  <StatTile
                    label="Colors"
                    value={formatColorIdentity(pool.color_identity)}
                  />
                </div>

                <ManaCurve curve={pool.curve} />
                <PoolTable pool={pool.pool} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
