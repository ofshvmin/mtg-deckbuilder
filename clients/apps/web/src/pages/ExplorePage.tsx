import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  edhrecPreviewCards,
  type ExploreFindDeck,
  type ExploreFindResponse,
  type ExternalDeckResponse,
  type ExternalDeckSummary,
  type PreconSummary,
} from "@mtg/shared";
import { api } from "../lib/api";
import { isPremiumRequired } from "@mtg/shared";
import { usePremiumUpgrade } from "../components/PremiumUpgrade";
import { useLayout } from "../components/Layout";
import type { Color } from "@mtg/shared";
import ColorPips from "../components/ColorPips";
import CommanderArt from "../components/CommanderArt";
import DeckView from "../components/DeckView";
import ImportCardsModal from "../components/ImportCardsModal";

// What the deck grid is showing: one commander's or one theme's community decks.
type Focus = { kind: "commander" | "theme"; label: string; key: string };

/** Best-effort card name for Scryfall art when commander_name isn't available. */
function preconArtName(p: { commander_name?: string; name: string }): string {
  if (p.commander_name) return p.commander_name;
  // Strip "Collector's Edition" and parenthetical suffixes like "(FINAL FANTASY X)"
  return p.name
    .replace(/\s*Collector'?s?\s*Edition\s*/i, " ")
    .replace(/\s*\([^)]+\)\s*$/, "")
    .trim();
}

type SearchResult = ExternalDeckSummary;
type PreconResult = PreconSummary;

export default function ExplorePage() {
  const { refreshSummary, refreshSaved } = useLayout();
  const { showUpgrade } = usePremiumUpgrade();
  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");

  // One search box: commanders, themes and decks by name, grouped.
  const [found, setFound] = useState<ExploreFindResponse | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const findSeq = useRef(0);

  // A commander or theme the player picked from the results: its community decks.
  const [focus, setFocus] = useState<Focus | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Landing: the newest precons, until something is searched.
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

  // Search as you type (debounced). Each source answers on its own, and a newer
  // query always wins over a slower older one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setFound(null);
      setFindError(null);
      return;
    }
    const t = setTimeout(() => void runFind(q), 400);
    return () => clearTimeout(t);
  }, [query]);

  async function runFind(q: string) {
    const mine = ++findSeq.current;
    setFinding(true);
    setFindError(null);
    setFocus(null);
    try {
      const data = await api.exploreFind(q);
      if (mine === findSeq.current) setFound(data);
    } catch (e) {
      if (mine === findSeq.current) setFindError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (mine === findSeq.current) setFinding(false);
    }
  }

  const openFocus = useCallback(async (next: Focus) => {
    setFocus(next);
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const data = next.kind === "commander"
        ? await api.searchExternalDecks(next.key)
        : await api.exploreTheme(next.key);
      setResults(data);
      if (data.length === 0) {
        setSearchError(
          next.kind === "commander"
            ? `EDHREC has no community decks for ${next.label} yet.`
            : `No community decks found for ${next.label}.`,
        );
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, []);

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
      const cards = preview ? edhrecPreviewCards(preview) : [];
      if (!cards.length) { setFetchError("Could not load deck."); return; }
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

  async function handleFetchFound(d: ExploreFindDeck) {
    if (d.kind === "precon") {
      return handleFetchPrecon({
        file_name: d.id, name: d.name, code: "", release_date: d.release_date ?? "",
        commander_name: d.commander_name ?? undefined, color_identity: d.color_identity,
        source: "precon",
      } as PreconResult);
    }
    setFetching(true);
    setFetchError(null);
    setFetchedDeck(null);
    setSavedId(null);
    try {
      setFetchedDeck(await api.fetchExternalDeck({ url: d.url }));
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
        source: fetchedDeck.source, source_url: fetchedDeck.source_url,
      });
      setSavedId(saved.id);
      refreshSaved();
    } catch (e) {
      if (isPremiumRequired(e)) showUpgrade("Unlimited saved decks");
      // else: silent, matching prior behavior
    } finally { setSaving(false); }
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

  const q = query.trim();
  const showLanding = q.length < 2;
  const nothingFound =
    found && !finding && found.commanders.length + found.themes.length + found.decks.length === 0;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Explore Decks</h2>

      <div className="space-y-2">
        <input type="search" value={query} autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && q.length >= 2 && void runFind(q)}
          placeholder="Search commanders, themes or deck names — “Atraxa”, “aristocrats”, “Borg”…"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-500" />
        <div className="flex gap-2">
          <input type="text" value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFetchByUrl()}
            placeholder="Or paste an EDHREC or Archidekt deck link…"
            className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600" />
          <button onClick={handleFetchByUrl} disabled={fetching || !urlInput.trim()}
            className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50">
            {fetching ? "…" : "Open"}
          </button>
        </div>
      </div>

      {fetchError && <p className="text-sm text-rose-400">{fetchError}</p>}
      {fetching && <p className="text-sm text-slate-400">Loading deck…</p>}

      {/* A commander's or theme's community decks */}
      {focus && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-100">
              {focus.kind === "commander" ? `Community decks for ${focus.label}` : `${focus.label} decks`}
            </h3>
            <button onClick={() => setFocus(null)} className="text-sm text-slate-400 hover:text-slate-200">
              ← All results for “{q}”
            </button>
          </div>
          {searching && <p className="text-sm text-slate-400">Searching EDHREC…</p>}
          {searchError && <p className="text-sm text-slate-400">{searchError}</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((d) => (
              <DeckTile key={d.external_id} onClick={() => handleFetchResult(d)} disabled={fetching}
                name={d.name} art={d.commander_art_crop} artist={d.commander_artist}
                artName={d.commander_name || "Unknown"}
                badge={d.bracket != null ? `B${d.bracket}` : null}
                line={<>{d.commander_name} · <ColorPips colors={d.color_identity as Color[]} /> · {d.card_count} cards</>}
                sub={d.price != null ? `$${d.price}` : null} />
            ))}
          </div>
        </section>
      )}

      {/* Grouped search results */}
      {!focus && !showLanding && (
        <div className="space-y-8">
          {finding && !found && <p className="text-sm text-slate-400">Searching…</p>}
          {findError && <p className="text-sm text-rose-400">{findError}</p>}
          {nothingFound && (
            <p className="text-sm text-slate-400">Nothing matched “{q}”. Try a commander, a theme like “tokens”, or part of a deck name.</p>
          )}
          {found && found.unavailable.length > 0 && (
            <p className="text-xs text-slate-500">{found.unavailable.join(" and ")} didn't answer — showing the rest.</p>
          )}

          {found && found.commanders.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">Commanders</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {found.commanders.map((c) => (
                  <button key={c.oracle_id}
                    onClick={() => void openFocus({ kind: "commander", label: c.name, key: c.name })}
                    className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 text-left transition hover:border-slate-600">
                    <CommanderArt name={c.name} className="h-20" artCropUrl={c.commander_art_crop} artist={c.commander_artist}>
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
                    </CommanderArt>
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="truncate text-sm text-slate-100 group-hover:text-emerald-300">{c.name}</span>
                      <ColorPips colors={c.color_identity as Color[]} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {found && found.themes.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">Themes</h3>
              <div className="flex flex-wrap gap-2">
                {found.themes.map((t) => (
                  <button key={t.slug}
                    onClick={() => void openFocus({ kind: "theme", label: t.name, key: t.slug })}
                    className="rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-emerald-600 hover:text-emerald-300">
                    {t.name} <span className="text-xs text-slate-500">{t.decks.toLocaleString()} decks</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {found && found.decks.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">Decks</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {found.decks.map((d) => (
                  <DeckTile key={`${d.kind}:${d.id}`} onClick={() => void handleFetchFound(d)} disabled={fetching}
                    name={d.name} art={d.commander_art_crop} artist={d.commander_artist}
                    artName={d.commander_name || d.name}
                    badge={d.kind === "precon" ? "Precon" : d.bracket != null ? `B${d.bracket}` : null}
                    line={<>
                      {d.kind === "precon" ? d.commander_name ?? "Official precon" : <>by {d.owner}</>}
                      {d.color_identity.length > 0 && <> · <ColorPips colors={d.color_identity as Color[]} /></>}
                    </>}
                    sub={d.kind === "archidekt"
                      ? `Archidekt${d.views ? ` · ${d.views.toLocaleString()} views` : ""}`
                      : d.release_date ?? null} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Landing: newest precons */}
      {showLanding && (
        <section className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">Newest precons</h3>
          {preconsError && <p className="text-sm text-rose-400">{preconsError}</p>}
          {preconsLoading && <p className="text-sm text-slate-400">Loading…</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {precons.map((p) => (
              <DeckTile key={p.file_name} onClick={() => handleFetchPrecon(p)} disabled={fetching}
                name={p.name} art={p.commander_art_crop} artist={p.commander_artist}
                artName={preconArtName(p)} badge={p.code.toUpperCase()}
                line={p.commander_name
                  ? <>{p.commander_name} · <ColorPips colors={(p.color_identity || []) as Color[]} /></>
                  : <>Official precon</>}
                sub={p.release_date} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DeckTile({
  onClick, disabled, name, art, artist, artName, badge, line, sub,
}: {
  onClick: () => void;
  disabled?: boolean;
  name: string;
  art?: string | null;
  artist?: string | null;
  artName: string;
  badge?: string | null;
  line: ReactNode;
  sub?: string | null;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 text-left transition hover:border-slate-700 disabled:opacity-50">
      <CommanderArt name={artName} className="h-36" artCropUrl={art} artist={artist}>
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
        {badge && (
          <div className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-slate-200">
            {badge}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className="truncate text-sm font-semibold text-white drop-shadow transition group-hover:text-emerald-300">
            {name}
          </h3>
        </div>
      </CommanderArt>
      <div className="px-3 py-2">
        <p className="truncate text-xs text-slate-400">{line}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
      </div>
    </button>
  );
}
