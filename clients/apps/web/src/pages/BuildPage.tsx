import { useState, useEffect } from "react";
import type { CommanderOption, GeneratedDeck, PoolResponse, StrategyOption } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import CommanderPicker from "../components/CommanderPicker";
import DeckView from "../components/DeckView";
import ManaCurve from "../components/ManaCurve";
import ManualBuilder from "../components/ManualBuilder";
import PoolTable from "../components/PoolTable";
import StatTile from "../components/StatTile";

type Mode = "auto" | "manual";

export default function BuildPage() {
  const { summary, refreshSaved } = useLayout();
  const [pool, setPool] = useState<PoolResponse | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);
  const [deck, setDeck] = useState<GeneratedDeck | null>(null);
  const [buildingDeck, setBuildingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("auto");
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("Balanced");
  const [theme, setTheme] = useState("");

  useEffect(() => {
    api.listStrategies().then(setStrategies).catch(() => {});
  }, []);

  async function selectCommander(c: CommanderOption) {
    setLoadingPool(true);
    setPoolError(null);
    setPool(null);
    setDeck(null);
    setMode("auto");
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
      const opts: { strategy?: string; theme?: string } = {};
      if (selectedStrategy && selectedStrategy !== "Balanced") opts.strategy = selectedStrategy;
      if (theme.trim()) opts.theme = theme.trim();
      setDeck(await api.generateDeck(pool.commander.name, opts));
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

  const toggleClass = (active: boolean) =>
    "rounded-md px-3 py-1.5 text-sm transition " +
    (active ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200");

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
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">{pool.commander.name}</h2>
              <p className="mt-1 text-sm text-slate-400">
                Color identity {formatColorIdentity(pool.color_identity)} · {pool.commander.type_line}
              </p>
            </div>
            {deck && (
              <button
                onClick={() => setDeck(null)}
                className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                ← Back to build
              </button>
            )}
          </div>

          {deck ? (
            <>
              {deckError && <p className="text-rose-400">{deckError}</p>}
              <DeckView deck={deck} onSaved={refreshSaved} />
            </>
          ) : (
            <>
              {/* Auto / Manual mode toggle */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-slate-700 p-0.5">
                  <button onClick={() => setMode("auto")} className={toggleClass(mode === "auto")}>
                    Auto-build
                  </button>
                  <button onClick={() => setMode("manual")} className={toggleClass(mode === "manual")}>
                    Build manually
                  </button>
                </div>
                {mode === "auto" && (
                  <button
                    onClick={buildDeck}
                    disabled={buildingDeck}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {buildingDeck ? "Building…" : "⚡ Build 99-card deck"}
                  </button>
                )}
              </div>

              {deckError && <p className="text-rose-400">{deckError}</p>}

              {mode === "auto" ? (
                <>
                  {/* Strategy picker */}
                  {strategies.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Strategy</label>
                      <div className="flex flex-wrap gap-2">
                        {strategies.map((s) => (
                          <button
                            key={s.name}
                            onClick={() => setSelectedStrategy(s.name)}
                            className={
                              "rounded-lg border px-3 py-1.5 text-sm transition " +
                              (selectedStrategy === s.name
                                ? "border-emerald-600 bg-emerald-600/20 text-emerald-300"
                                : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200")
                            }
                            title={s.description}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                      {selectedStrategy && selectedStrategy !== "Balanced" && (
                        <p className="text-xs text-slate-500">
                          {strategies.find((s) => s.name === selectedStrategy)?.description}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Theme input */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Theme (optional)</label>
                    <input
                      type="text"
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                      placeholder="e.g. cats, landfall, zombies, tokens..."
                      className="max-w-sm rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <StatTile label="Legal pool" value={pool.pool_size.toLocaleString()} />
                    <StatTile label="Lands" value={pool.land_count} />
                    <StatTile label="Nonlands" value={pool.pool_size - pool.land_count} />
                    <StatTile label="Colors" value={formatColorIdentity(pool.color_identity)} />
                  </div>
                  <ManaCurve curve={pool.curve} />
                  <PoolTable pool={pool.pool} />
                </>
              ) : (
                <ManualBuilder pool={pool} commanderName={pool.commander.name} onSaved={refreshSaved} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
