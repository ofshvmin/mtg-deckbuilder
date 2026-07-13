import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { BriefDeckResponse, CommanderOption, GeneratedDeck, PoolResponse, StrategyOption } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import AiPlanPanel from "../components/AiPlanPanel";
import CommanderFeature from "../components/CommanderFeature";
import CommanderPicker from "../components/CommanderPicker";
import DeckView from "../components/DeckView";
import ManaCurve from "../components/ManaCurve";
import ManualBuilder from "../components/ManualBuilder";
import PoolTable from "../components/PoolTable";
import StatTile from "../components/StatTile";

type Mode = "auto" | "manual" | "brief";

type EditSeed = { selected: string[]; deckId?: string; deckName?: string };

export default function BuildPage() {
  const { summary, refreshSaved } = useLayout();
  const location = useLocation();
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
  const [editSeed, setEditSeed] = useState<EditSeed | null>(null);
  const editApplied = useRef(false);
  const [briefText, setBriefText] = useState("");
  const [briefResult, setBriefResult] = useState<BriefDeckResponse | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  useEffect(() => {
    api.listStrategies().then(setStrategies).catch(() => {});
  }, []);

  // Editing an existing saved deck: DecksPage navigates here with router state.
  useEffect(() => {
    if (editApplied.current) return;
    const st = location.state as
      | { editCommander?: string; editSelected?: string[]; editDeckId?: string; editDeckName?: string }
      | null;
    if (!st?.editCommander) return;
    editApplied.current = true;
    (async () => {
      setLoadingPool(true);
      setPoolError(null);
      setDeck(null);
      setMode("manual");
      try {
        setPool(await api.getPool(st.editCommander!));
        setEditSeed({
          selected: st.editSelected ?? [],
          deckId: st.editDeckId,
          deckName: st.editDeckName,
        });
      } catch (e) {
        setPoolError(e instanceof Error ? e.message : "Could not load pool");
      } finally {
        setLoadingPool(false);
      }
    })();
  }, [location.state]);

  async function selectCommander(c: CommanderOption) {
    setLoadingPool(true);
    setPoolError(null);
    setPool(null);
    setDeck(null);
    setMode("auto");
    setEditSeed(null);
    setBriefResult(null);
    setBriefText("");
    try {
      setPool(await api.getPool(c.name));
    } catch (e) {
      setPoolError(e instanceof Error ? e.message : "Could not load pool");
    } finally {
      setLoadingPool(false);
    }
  }

  // "Edit cards" on a built deck → open the manual editor seeded with its cards.
  function editDeck(built: GeneratedDeck, deckId?: string, deckName?: string) {
    setEditSeed({
      selected: built.cards
        .filter((c) => !c.oracle_id.startsWith("basic:"))
        .map((c) => c.oracle_id),
      deckId,
      deckName,
    });
    setMode("manual");
    setDeck(null);
  }

  async function buildDeck() {
    if (!pool) return;
    setBuildingDeck(true);
    setDeckError(null);
    setBriefResult(null);
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

  async function submitBrief() {
    if (!pool || !briefText.trim()) return;
    setBriefing(true);
    setBriefError(null);
    try {
      const res = await api.briefDeck(pool.commander.name, briefText.trim());
      setBriefResult(res);
      setDeck(res.deck);
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : "Couldn't build from your description.");
    } finally {
      setBriefing(false);
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
          {deck ? (
            <div className="flex justify-end">
              <button
                onClick={() => setDeck(null)}
                className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                ← Back to build
              </button>
            </div>
          ) : (
            <CommanderFeature
              name={pool.commander.name}
              oracleId={pool.commander.oracle_id}
              colorIdentity={pool.color_identity}
              typeLine={pool.commander.type_line}
              manaCost={pool.commander.mana_cost}
              oracleText={pool.commander.oracle_text}
            />
          )}

          {deck ? (
            <>
              {deckError && <p className="text-rose-400">{deckError}</p>}
              {briefResult && <AiPlanPanel result={briefResult} />}
              <DeckView deck={deck} onSaved={refreshSaved} onEdit={(d) => editDeck(d)} />
            </>
          ) : (
            <>
              {/* Strategy + theme — not shown for the AI-brief mode (Claude sets them) */}
              {mode !== "brief" && strategies.length > 0 && (
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

              {/* Theme input — not shown for the AI-brief mode */}
              {mode !== "brief" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Theme (optional)</label>
                  <input
                    type="text"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    placeholder="e.g. cats, landfall, zombies, Urza, tokens..."
                    className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
                  />
                  <p className="text-xs text-slate-500">
                    Matches card names, creature types, and oracle text. Try a tribe, mechanic, or keyword.
                  </p>
                </div>
              )}

              {/* Build mode toggle */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-slate-700 p-0.5">
                  <button onClick={() => setMode("auto")} className={toggleClass(mode === "auto")}>
                    Auto-build
                  </button>
                  <button onClick={() => setMode("manual")} className={toggleClass(mode === "manual")}>
                    Build manually
                  </button>
                  <button onClick={() => setMode("brief")} className={toggleClass(mode === "brief")}>
                    ✨ Describe
                  </button>
                </div>
                {mode === "auto" && (
                  <button
                    onClick={buildDeck}
                    disabled={buildingDeck}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {buildingDeck ? "Building…" : "Build 99-card deck"}
                  </button>
                )}
              </div>

              {deckError && <p className="text-rose-400">{deckError}</p>}

              {mode === "brief" ? (
                <div className="max-w-2xl space-y-3">
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Describe the deck you want
                  </label>
                  <textarea
                    value={briefText}
                    onChange={(e) => setBriefText(e.target.value)}
                    rows={4}
                    placeholder="e.g. A grindy treasure-sacrifice deck focused on card advantage — no infinite combos, keep it around bracket 3."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={submitBrief}
                      disabled={briefing || !briefText.trim()}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {briefing ? "Consulting Claude…" : "✨ Build from description"}
                    </button>
                    <span className="text-xs text-slate-500">
                      Claude picks the core cards from your collection; the engine builds the rest.
                    </span>
                  </div>
                  {briefError && <p className="text-sm text-rose-400">{briefError}</p>}
                  <p className="text-xs text-slate-500">
                    Try: “aggressive goblins, low curve”, “spellslinger with lots of card draw, no combos”,
                    or “aristocrats value engine that grinds the game out”.
                  </p>
                </div>
              ) : mode === "auto" ? (
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
              ) : (
                <ManualBuilder
                  key={editSeed?.deckId ?? (editSeed ? "edit" : "new")}
                  pool={pool}
                  commanderName={pool.commander.name}
                  strategy={selectedStrategy}
                  theme={theme}
                  onSaved={refreshSaved}
                  initialSelected={editSeed?.selected}
                  deckId={editSeed?.deckId}
                  deckName={editSeed?.deckName}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
