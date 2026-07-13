import { useCallback, useState } from "react";
import type { ExternalDeckResponse } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import type { Color } from "@mtg/shared";
import { fetchDeckHashes } from "../lib/edhrec";
import CommanderArt from "../components/CommanderArt";
import DeckView from "../components/DeckView";
import ImportCardsModal from "../components/ImportCardsModal";

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

export default function ExplorePage() {
  const { refreshSummary, refreshSaved } = useLayout();
  const [commander, setCommander] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [fetchedDeck, setFetchedDeck] = useState<ExternalDeckResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Step 1: Client fetches hash list from json.edhrec.com (has CORS)
  // Step 2: Send hashes to our backend which proxies deckpreview calls
  const handleSearch = useCallback(async () => {
    const q = commander.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setFetchedDeck(null);
    setSavedId(null);
    try {
      // Client-side: fetch hash list from EDHREC (has CORS)
      const hashes = await fetchDeckHashes(q, 20);
      if (hashes.length === 0) {
        setSearchError("No decks found for that commander on EDHREC.");
        setResults([]);
        return;
      }
      // Server-side: proxy deckpreview calls (no CORS on edhrec.com/api)
      const hashIds = hashes.map((h) => h.urlhash);
      const previews = await api.fetchEdhrecPreviews(hashIds);
      // Merge bracket/price from the original hash table
      const hashMap = new Map(hashes.map((h) => [h.urlhash, h]));
      const merged: SearchResult[] = previews.map((p) => ({
        ...p,
        bracket: p.bracket ?? hashMap.get(p.external_id)?.bracket ?? null,
        price: p.price ?? (hashMap.get(p.external_id)?.price ? Math.round(hashMap.get(p.external_id)!.price!) : null),
      }));
      setResults(merged);
      if (merged.length === 0) setSearchError("No decks could be loaded.");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [commander]);

  // Fetch Archidekt URL via our backend
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

  // Fetch full deck: proxy EDHREC preview via backend, then resolve cards
  async function handleFetchResult(result: SearchResult) {
    setFetching(true);
    setFetchError(null);
    setFetchedDeck(null);
    setSavedId(null);
    try {
      // Fetch full preview via our backend proxy
      const preview = await api.fetchEdhrecDeck(result.external_id);
      if (!preview?.deck?.length) {
        setFetchError("Could not load deck from EDHREC.");
        return;
      }
      // Parse card list and resolve via backend
      const commanders = new Set(preview.commanders ?? []);
      const cards = (preview.deck ?? [])
        .filter((line: string) => line?.trim())
        .map((line: string) => {
          const parts = line.trim().split(" ", 2);
          const qty = parseInt(parts[0], 10) || 1;
          const name = line.trim().substring(parts[0].length).trim();
          return { name, quantity: qty, is_commander: commanders.has(name) };
        })
        .filter((c: { name: string }) => c.name);

      const data = await api.resolveExternalDeck({
        cards,
        source: result.source,
        source_url: result.url,
        name: result.name,
        owner: result.owner,
      });
      setFetchedDeck(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to fetch deck");
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    if (!fetchedDeck || saving) return;
    setSaving(true);
    try {
      const saved = await api.saveDeck(fetchedDeck.name, fetchedDeck.deck, {
        source: fetchedDeck.source,
        source_url: fetchedDeck.source_url,
      });
      setSavedId(saved.id);
      refreshSaved();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  if (fetchedDeck) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => { setFetchedDeck(null); setSavedId(null); }}
            className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
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
            From <span className="capitalize text-slate-200">{fetchedDeck.source}</span>
            {fetchedDeck.owner !== "Unknown" && fetchedDeck.owner !== "EDHREC" && (
              <> by <span className="text-slate-200">{fetchedDeck.owner}</span></>
            )}
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-400">{fetchedDeck.owned_count} owned</span>
          {fetchedDeck.unowned_count > 0 && (
            <>
              <span className="text-slate-600">|</span>
              <span className="text-slate-500">{fetchedDeck.unowned_count} unowned</span>
            </>
          )}
          {savedId && <span className="ml-auto text-emerald-400">Saved</span>}
        </div>

        <DeckView
          deck={fetchedDeck.deck}
          deckName={fetchedDeck.name}
          deckId={savedId ?? undefined}
          onSaved={() => refreshSaved()}
          showOwnership
        />

        {showImport && (
          <ImportCardsModal
            deck={fetchedDeck.deck}
            unownedCount={fetchedDeck.unowned_count}
            onClose={() => setShowImport(false)}
            onImported={() => { refreshSummary(); setShowImport(false); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Explore Decks</h2>

      <div className="space-y-3">
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
            {fetching ? "Fetching…" : "Import"}
          </button>
        </div>
      </div>

      {searchError && <p className="text-sm text-rose-400">{searchError}</p>}
      {fetchError && <p className="text-sm text-rose-400">{fetchError}</p>}
      {fetching && <p className="text-sm text-slate-400">Loading deck…</p>}

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
                {d.price != null && (
                  <p className="mt-0.5 text-xs text-slate-500">${d.price}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
