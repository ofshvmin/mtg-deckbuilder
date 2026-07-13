import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { GeneratedDeck, SavedDeckSummary } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import BracketBadge from "../components/BracketBadge";
import CommanderArt from "../components/CommanderArt";
import DeckView from "../components/DeckView";

export default function DecksPage() {
  const { refreshSaved } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const deepOpened = useRef(false);
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDeck, setOpenDeck] = useState<{ id: string; name: string; deck: GeneratedDeck; source?: string | null } | null>(
    null,
  );
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      setOpenDeck({ id: saved.id, name: saved.name, deck: saved.deck, source: saved.source });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load deck");
    } finally {
      setOpening(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteSavedDeck(id);
      setDecks((prev) => prev.filter((d) => d.id !== id));
      refreshSaved();
    } catch {
      // silent
    }
  }

  function onSaved() {
    loadDecks();
    refreshSaved();
  }

  // "Edit cards" on a saved deck → open the manual editor seeded with its cards.
  function editInBuilder(deck: GeneratedDeck) {
    if (!openDeck) return;
    navigate("/build", {
      state: {
        editCommander: deck.commander.name,
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
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Saved decks</h2>
        {decks.length >= 2 && (
          <div className="flex items-center gap-2">
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
          </div>
        )}
      </div>
      {error && <p className="text-rose-400">{error}</p>}
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
                <CommanderArt name={d.commander_name} className="h-40">
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
                <button
                  onClick={() => remove(d.id)}
                  className="shrink-0 text-xs text-slate-600 hover:text-rose-400"
                  title="Delete deck"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
