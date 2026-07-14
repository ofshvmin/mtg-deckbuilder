import { useCallback, useEffect, useState } from "react";
import type { ExternalDeckResponse } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import type { Color } from "@mtg/shared";
import CommanderArt from "../components/CommanderArt";
import DeckView from "../components/DeckView";
import ImportCardsModal from "../components/ImportCardsModal";

type Tab = "community" | "precons";

interface SearchResult {
  external_id: string;
  source: string;
  name: string;
  owner: string;
  card_count: number;
  url: string;
  commander_name: string;
  color_identity: string[];
  bracket: number | null;
  price: number | null;
}

interface PreconResult {
  file_name: string;
  name: string;
  code: string;
  release_date: string;
  commander_name?: string;
  color_identity?: string[];
}

export default function ExplorePage() {
  const { refreshSummary, refreshSaved } = useLayout();
  const [tab, setTab] = useState<Tab>("precons");
  const [commander, setCommander] = useState("");
  const [urlInput, setUrlInput] = useState("");

  // Community (EDHREC) state
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Precon state
  const [preconQuery, setPreconQuery] = useState("");
  const [precons, setPrecons] = useState<PreconResult[]>([]);
  const [preconsLoading, setPreconsLoading] = useState(false);
  const [preconsError, setPreconsError] = useState<string | null>(null);

  // Shared deck view state
  const [fetchedDeck, setFetchedDeck] = useState<ExternalDeckResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Load precons on mount
  useEffect(() => {
    loadPrecons("");
  }, []);

  async function loadPrecons(q: string) {
    setPreconsLoading(true);
    setPreconsError(null);
    try {
      const data = await api.searchPrecons(q, 30);
      setPrecons(data);
    } catch (e) {
      setPreconsError(e instanceof Error ? e.message : "Failed to load precons");
    } finally {
      setPreconsLoading(false);
    }
  }

  const handleSearch = useCallback(async () => {
    const q = commander.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setFetchedDeck(null);
    setSavedId(null);
    try {
      const data = await api.searchExternalDecks(q);
      setResults(data);
      if (data.length === 0) setSearchError("No decks found for that commander on EDHREC.");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [commander]);

  async function handleFetchByUrl() {
    const u = urlInput.trim();
    if (!u) return;
    setFetching(true);
    setFetchError(null);
    setFetchedDeck(null);
    setSavedId(null);
    try {
      const data = await api.fetchExternalDeck({ url: u });
      setFetchedDeck(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to fetch deck");
    } finally {
      setFetching(false);
    }
  }

  async function handleFetchResult(result: SearchResult) {
    setFetching(true);
    setFetchError(null);
    setFetchedDeck(null);
    setSavedId(null);
    try {
      const preview = await api.fetchEdhrecDeck(result.external_id);
      if (!preview?.deck?.length) { setFetchError("Could not load deck."); return; }
      const commanders = new Set(preview.commanders ?? []);
      const cards = (preview.deck ?? [])
        .filter((line: string) => line?.trim())
        .map((line: string) => {
          const first = line.trim().split(" ", 2);
          const qty = parseInt(first[0], 10) || 1;
          const name = line.trim().substring(first[0].length).trim();
          return { name, quantity: qty, is_commander: commanders.has(name) };
        })
        .filter((c: { name: string }) => c.name);
      const data = await api.resolveExternalDeck({
        cards, source: result.source, source_url: result.url, name: result.name, owner: result.owner,
      });
      setFetchedDeck(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to fetch deck");
    } finally {
      setFetching(false);
    }
  }

  async function handleFetchPrecon(precon: PreconResult) {
    setFetching(true);
    setFetchError(null);
    setFetchedDeck(null);
    setSavedId(null);
    try {
      const data = await api.fetchPrecon(precon.file_name);
      setFetchedDeck(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load precon");
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    if (!fetchedDeck || saving) return;
    setSaving(true);
    try {
      const saved = await api.saveDeck(fetchedDeck.name, fetchedDeck.deck, {
        source: fetchedDeck.source, source_url: fetchedDeck.source_url,
      });
      setSavedId(saved.id);
      refreshSaved();
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  // Deck detail view
  if (fetchedDeck) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => { setFetchedDeck(null); setSavedId(null); }}
            className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800">
            ← Back to search
          </button>
          <div className="flex items-center gap-2">
            {!savedId && (
              <button onClick={handleSave} disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50">
                {saving ? "Saving…" : "Save to My Decks"}
              </button>
            )}
            {savedId && (
              <button onClick={() => setShowImport(true)}
                className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-900/30">
                Import Cards to Collection
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-400">
          <span>
            {fetchedDeck.source === "precon" ? "Official precon" : (
              <>From <span className="capitalize text-slate-200">{fetchedDeck.source}</span></>
            )}
            {fetchedDeck.owner !== "Unknown" && fetchedDeck.owner !== "EDHREC" && (
              <> by <span className="text-slate-200">{fetchedDeck.owner}</span></>
            )}
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-400">{fetchedDeck.owned_count} owned</span>
          {fetchedDeck.unowned_count > 0 && (
            <><span className="text-slate-600">|</span>
            <span className="text-slate-500">{fetchedDeck.unowned_count} unowned</span></>
          )}
          {savedId && <span className="ml-auto text-emerald-400">Saved</span>}
        </div>
        <DeckView deck={fetchedDeck.deck} deckName={fetchedDeck.name}
          deckId={savedId ?? undefined} onSaved={() => refreshSaved()} showOwnership />
        {showImport && (
          <ImportCardsModal deck={fetchedDeck.deck} unownedCount={fetchedDeck.unowned_count}
            onClose={() => setShowImport(false)}
            onImported={() => { refreshSummary(); setShowImport(false); }} />
        )}
      </div>
    );
  }

  const tabClass = (t: Tab) =>
    "rounded-lg px-4 py-2 text-sm font-medium transition " +
    (tab === t ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold">Explore Decks</h2>
        <div className="flex rounded-lg border border-slate-700 p-0.5">
          <button className={tabClass("precons")} onClick={() => setTab("precons")}>Precons</button>
          <button className={tabClass("community")} onClick={() => setTab("community")}>Community</button>
        </div>
      </div>

      {fetchError && <p className="text-sm text-rose-400">{fetchError}</p>}
      {fetching && <p className="text-sm text-slate-400">Loading deck…</p>}

      {tab === "precons" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input type="text" value={preconQuery}
              onChange={(e) => setPreconQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadPrecons(preconQuery)}
              placeholder="Search precons by name or set code…"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500" />
            <button onClick={() => loadPrecons(preconQuery)} disabled={preconsLoading}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50">
              {preconsLoading ? "…" : "Search"}
            </button>
          </div>
          {preconsError && <p className="text-sm text-rose-400">{preconsError}</p>}
          {precons.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {precons.map((p) => (
                <button key={p.file_name} onClick={() => handleFetchPrecon(p)} disabled={fetching}
                  className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 text-left transition hover:border-slate-700 disabled:opacity-50">
                  <CommanderArt name={p.commander_name || p.name} className="h-36">
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
                    <div className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-slate-200">
                      {p.code.toUpperCase()}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <h3 className="truncate text-sm font-semibold text-white drop-shadow transition group-hover:text-emerald-300">
                        {p.name}
                      </h3>
                    </div>
                  </CommanderArt>
                  <div className="px-3 py-2">
                    <p className="truncate text-xs text-slate-400">
                      {p.commander_name
                        ? <>{p.commander_name} · {formatColorIdentity((p.color_identity || []) as Color[])} · </>
                        : null}
                      {p.release_date}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!preconsLoading && precons.length === 0 && !preconsError && (
            <p className="text-sm text-slate-500">No precons found.</p>
          )}
        </div>
      )}

      {tab === "community" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input type="text" value={commander}
              onChange={(e) => setCommander(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search by commander name…"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500" />
            <button onClick={handleSearch} disabled={searching || !commander.trim()}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50">
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          <div className="flex gap-2">
            <input type="text" value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFetchByUrl()}
              placeholder="Or paste an Archidekt URL…"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500" />
            <button onClick={handleFetchByUrl} disabled={fetching || !urlInput.trim()}
              className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50">
              {fetching ? "…" : "Import"}
            </button>
          </div>
          {searchError && <p className="text-sm text-rose-400">{searchError}</p>}
          {results.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((d) => (
                <button key={d.external_id} onClick={() => handleFetchResult(d)} disabled={fetching}
                  className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 text-left transition hover:border-slate-700 disabled:opacity-50">
                  <CommanderArt name={d.commander_name || "Unknown"} className="h-36">
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
                    {d.bracket != null && (
                      <div className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-slate-200">
                        B{d.bracket}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <h3 className="truncate text-sm font-semibold text-white drop-shadow transition group-hover:text-emerald-300">
                        {d.name}
                      </h3>
                    </div>
                  </CommanderArt>
                  <div className="px-3 py-2">
                    <p className="truncate text-xs text-slate-400">
                      {d.commander_name} · {formatColorIdentity(d.color_identity as Color[])} · {d.card_count} cards
                    </p>
                    {d.price != null && <p className="mt-0.5 text-xs text-slate-500">${d.price}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
