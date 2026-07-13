import { useCallback, useState } from "react";
import type { ExternalDeckResponse, ExternalDeckSummary, GeneratedDeck } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import type { Color } from "@mtg/shared";
import CommanderArt from "../components/CommanderArt";
import DeckView from "../components/DeckView";
import ImportCardsModal from "../components/ImportCardsModal";

export default function ExplorePage() {
  const { refreshSummary, refreshSaved } = useLayout();
  const [commander, setCommander] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [results, setResults] = useState<ExternalDeckSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [fetchedDeck, setFetchedDeck] = useState<ExternalDeckResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

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
      if (data.length === 0) setSearchError("No decks found for that commander.");
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

  async function handleFetchResult(summary: ExternalDeckSummary) {
    setFetching(true);
    setFetchError(null);
    setFetchedDeck(null);
    setSavedId(null);
    try {
      // Search results come from EDHREC; use the hash to fetch the full deck
      const opts = summary.source === "archidekt"
        ? { archidektId: summary.external_id }
        : { edhrecHash: summary.external_id };
      const data = await api.fetchExternalDeck(opts);
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

  // If viewing a fetched deck, show it
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
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save to My Decks"}
              </button>
            )}
            {savedId && (
              <button
                onClick={() => setShowImport(true)}
                className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-900/30"
              >
                Import Cards to Collection
              </button>
            )}
          </div>
        </div>

        {/* Source attribution */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-400">
          <span>
            From <span className="capitalize text-slate-200">{fetchedDeck.source}</span> by{" "}
            <span className="text-slate-200">{fetchedDeck.owner}</span>
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
            onImported={() => {
              refreshSummary();
              setShowImport(false);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Explore Decks</h2>

      {/* Commander search */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={commander}
            onChange={(e) => setCommander(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by commander name…"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !commander.trim()}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {/* URL import */}
        <div className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFetchByUrl()}
            placeholder="Or paste an Archidekt URL…"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <button
            onClick={handleFetchByUrl}
            disabled={fetching || !urlInput.trim()}
            className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            {fetching ? "Fetching…" : "Import"}
          </button>
        </div>
      </div>

      {searchError && <p className="text-sm text-rose-400">{searchError}</p>}
      {fetchError && <p className="text-sm text-rose-400">{fetchError}</p>}
      {fetching && <p className="text-sm text-slate-400">Fetching deck…</p>}

      {/* Results grid */}
      {results.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((d) => (
            <button
              key={d.external_id}
              onClick={() => handleFetchResult(d)}
              disabled={fetching}
              className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 text-left transition hover:border-slate-700 disabled:opacity-50"
            >
              <CommanderArt name={d.commander_name || "Unknown"} className="h-36">
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
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
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  by {d.owner}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
