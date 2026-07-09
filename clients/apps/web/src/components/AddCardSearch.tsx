import { useEffect, useRef, useState } from "react";
import type { CardSearchResult } from "@mtg/shared";
import { api } from "../lib/api";

export default function AddCardSearch({
  onAdded,
  onClose,
}: {
  onAdded: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api.searchCards(query.trim(), 15));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function addCard(card: CardSearchResult) {
    setAdding(card.oracle_id);
    setError(null);
    try {
      await api.addCard(card.name);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add card");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-200">Add card to collection</h3>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a card…"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
      />
      {searching && <p className="mt-2 text-xs text-slate-500">Searching…</p>}
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      {results.length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-slate-800/60 overflow-y-auto rounded-lg border border-slate-800">
          {results.map((card) => (
            <li key={card.oracle_id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="text-slate-200">{card.name}</span>
                <span className="ml-2 text-xs text-slate-500">{card.type_line}</span>
              </div>
              <button
                onClick={() => addCard(card)}
                disabled={adding === card.oracle_id}
                className="shrink-0 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {adding === card.oracle_id ? "…" : "Add"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
