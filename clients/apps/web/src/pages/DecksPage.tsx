import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { GeneratedDeck, SavedDeckSummary } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import BracketBadge from "../components/BracketBadge";
import CommanderArt from "../components/CommanderArt";
import DeckView from "../components/DeckView";
import ImportDeckModal from "../components/ImportDeckModal";

export default function DecksPage() {
  const { refreshSaved } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const deepOpened = useRef(false);
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDeck, setOpenDeck] = useState<{
    id: string; name: string; deck: GeneratedDeck; source?: string | null; inUse?: boolean;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SavedDeckSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadDecks = useCallback(() => {
    api
      .listSavedDecks()
      .then(setDecks)
      .catch(() => setDecks([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(loadDecks, [loadDecks]);

  // Open a specific deck when navigated here from Home (recent-deck tile).
  useEffect(() => {
    const st = location.state as { openDeckId?: string } | null;
    if (st?.openDeckId && !deepOpened.current) {
      deepOpened.current = true;
      open(st.openDeckId);
    }
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(id: string) {
    setOpening(true);
    setError(null);
    try {
      const saved = await api.getSavedDeck(id);
      setOpenDeck({
        id: saved.id, name: saved.name, deck: saved.deck,
        source: saved.source, inUse: saved.in_use,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load deck");
    } finally {
      setOpening(false);
    }
  }

  /** Delete a deck and say what came back.
   *
   *  Availability is derived from the decks that still exist, so removing an
   *  in-use deck hands its copies straight back to the pool — worth stating,
   *  since nothing else on screen would show it.
   */
  async function remove(deck: SavedDeckSummary) {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteSavedDeck(deck.id);
      setDecks((prev) => prev.filter((d) => d.id !== deck.id));
      setConfirmDelete(null);
      setNotice(
        deck.in_use
          ? `Deleted “${deck.name}” — its ${deck.total} cards are available again.`
          : `Deleted “${deck.name}”.`,
      );
      refreshSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that deck");
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  function onImported(deckId: string) {
    setImporting(false);
    loadDecks();
    refreshSaved();
    open(deckId);
  }

  function onSaved() {
    loadDecks();
    refreshSaved();
  }

  /** Reserve or release a deck's cards without opening it.
   *
   *  Optimistic — the tile flips immediately and reverts if the write fails.
   *  Marking a shelf of decks in use is a sweep across the grid, and a round-trip
   *  per click would make that feel broken.
   */
  async function toggleInUse(deck: SavedDeckSummary) {
    const next = !deck.in_use;
    setDecks((prev) => prev.map((d) => (d.id === deck.id ? { ...d, in_use: next } : d)));
    try {
      await api.updateSavedDeck(deck.id, { in_use: next });
    } catch {
      setDecks((prev) => prev.map((d) => (d.id === deck.id ? { ...d, in_use: !next } : d)));
    }
  }

  // "Edit cards" on a saved deck → open the manual editor seeded with its cards.
  function editInBuilder(deck: GeneratedDeck) {
    // The manual builder still assumes a commander (and a singleton selection
    // model), so editing is Commander-only until that lands.
    if (!openDeck || !deck.commander) return;
    navigate("/build", {
      state: {
        editCommander: deck.commander!.name,
        editSelected: deck.cards
          .filter((c) => !c.oracle_id.startsWith("basic:"))
          .map((c) => c.oracle_id),
        editDeckId: openDeck.id,
        editDeckName: openDeck.name,
      },
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  }

  function handleCompare() {
    const ids = [...selected];
    if (ids.length === 2) {
      navigate(`/compare?a=${encodeURIComponent(ids[0])}&b=${encodeURIComponent(ids[1])}`);
    }
  }

  if (openDeck) {
    return (
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            onClick={() => setOpenDeck(null)}
            className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            ← All decks
          </button>
        </div>
        <DeckView
          deck={openDeck.deck}
          deckName={openDeck.name}
          deckId={openDeck.id}
          onSaved={onSaved}
          onEdit={openDeck.source ? undefined : editInBuilder}
          showOwnership={!!openDeck.source}
          inUse={openDeck.inUse}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Saved decks</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setNotice(null); setImporting(true); }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800"
            title="Import a decklist from text or a CSV export"
          >
            Import deck
          </button>
          {decks.length >= 2 && (
            <>
              {comparing && selected.size === 2 && (
                <button
                  onClick={handleCompare}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
                >
                  Compare Selected
                </button>
              )}
              <button
                onClick={() => { setComparing((c) => !c); setSelected(new Set()); }}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm transition " +
                  (comparing
                    ? "border-indigo-600 bg-indigo-600/20 text-indigo-300"
                    : "border-slate-700 text-slate-300 hover:bg-slate-800")
                }
              >
                {comparing ? "Cancel" : "Compare"}
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-rose-400">{error}</p>}
      {notice && (
        <p className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
          <span className="min-w-0 flex-1">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 text-slate-500 transition hover:text-slate-300"
            title="Dismiss"
          >
            ✕
          </button>
        </p>
      )}
      {loading ? (
        <p className="text-slate-400">Loading decks…</p>
      ) : decks.length === 0 ? (
        <p className="text-sm text-slate-500">
          No saved decks yet — build one from the Build tab and save it.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((d) => (
            <div
              key={d.id}
              className={
                "group overflow-hidden rounded-xl border bg-slate-900/60 transition " +
                (comparing && selected.has(d.id)
                  ? "border-indigo-500 ring-2 ring-indigo-500/40"
                  : "border-slate-800 hover:border-slate-700")
              }
            >
              <button
                onClick={() => comparing ? toggleSelect(d.id) : open(d.id)}
                disabled={!comparing && opening}
                className="block w-full text-left"
                title={comparing ? `Select ${d.name}` : `Open ${d.name}`}
              >
                <CommanderArt
                  name={d.commander_name}
                  className="h-40"
                  artCropUrl={d.commander_art_crop}
                  artist={d.commander_artist}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
                  {comparing && (
                    <div className="absolute left-2 top-2">
                      <div className={
                        "flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold " +
                        (selected.has(d.id)
                          ? "border-indigo-500 bg-indigo-600 text-white"
                          : "border-slate-400 bg-slate-900/80 text-slate-400")
                      }>
                        {selected.has(d.id) ? "✓" : ""}
                      </div>
                    </div>
                  )}
                  {d.bracket != null && (
                    <div className="absolute right-2 top-2">
                      <BracketBadge
                        compact
                        bracket={{ bracket: d.bracket, label: d.bracket_label ?? "", explanation: "", signals: [] }}
                      />
                    </div>
                  )}
                  {d.in_use && (
                    <div className={"absolute top-2 " + (d.bracket != null ? "right-14" : "right-2")}>
                      <span
                        className="rounded-full border border-emerald-500/60 bg-emerald-950/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300"
                        title="This deck's cards are reserved from other builds"
                      >
                        In use
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <h3 className="truncate text-sm font-semibold text-white drop-shadow transition group-hover:text-emerald-300">
                      {d.name}
                    </h3>
                  </div>
                </CommanderArt>
              </button>
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <p className="min-w-0 truncate text-xs text-slate-400">
                  {d.commander_name} · {formatColorIdentity(d.color_identity)} · {d.total} cards
                  {d.source && <span className="ml-1 text-slate-600">· {d.source}</span>}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggleInUse(d)}
                    className={
                      "text-xs transition " +
                      (d.in_use
                        ? "text-emerald-400 hover:text-emerald-300"
                        : "text-slate-600 hover:text-slate-300")
                    }
                    title={
                      d.in_use
                        ? "Release this deck's cards back into the pool"
                        : "Mark assembled — reserve this deck's cards from other builds"
                    }
                  >
                    {d.in_use ? "◉ In use" : "○ Free"}
                  </button>
                  <button
                    onClick={() => { setNotice(null); setConfirmDelete(d); }}
                    className="text-xs text-slate-600 transition hover:text-rose-400"
                    title={`Delete ${d.name}`}
                    aria-label={`Delete ${d.name}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {importing && (
        <ImportDeckModal onClose={() => setImporting(false)} onSaved={onImported} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Delete this deck?</h3>
            <p className="mt-2 text-sm text-slate-400">
              “{confirmDelete.name}” will be removed for good.
              {confirmDelete.in_use
                ? ` Its ${confirmDelete.total} cards go back into your available pool.`
                : " Your collection is unchanged."}
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => remove(confirmDelete)}
                disabled={deleting}
                className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete deck"}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
