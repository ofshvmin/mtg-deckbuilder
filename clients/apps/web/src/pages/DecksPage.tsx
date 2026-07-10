import { useCallback, useEffect, useState } from "react";
import type { GeneratedDeck, SavedDeckSummary } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { formatColorIdentity } from "../lib/format";
import CommanderArt from "../components/CommanderArt";
import DeckView from "../components/DeckView";

export default function DecksPage() {
  const { refreshSaved } = useLayout();
  const [decks, setDecks] = useState<SavedDeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDeck, setOpenDeck] = useState<{ id: string; name: string; deck: GeneratedDeck } | null>(
    null,
  );
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDecks = useCallback(() => {
    api
      .listSavedDecks()
      .then(setDecks)
      .catch(() => setDecks([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(loadDecks, [loadDecks]);

  async function open(id: string) {
    setOpening(true);
    setError(null);
    try {
      const saved = await api.getSavedDeck(id);
      setOpenDeck({ id: saved.id, name: saved.name, deck: saved.deck });
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

  if (openDeck) {
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{openDeck.name}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {openDeck.deck.commander.name} · Color identity{" "}
              {formatColorIdentity(openDeck.deck.color_identity)}
            </p>
          </div>
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
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Saved decks</h2>
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
              className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 transition hover:border-slate-700"
            >
              <button
                onClick={() => open(d.id)}
                disabled={opening}
                className="block w-full text-left"
                title={`Open ${d.name}`}
              >
                <CommanderArt name={d.commander_name} className="h-28">
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
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
