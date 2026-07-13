import { useState } from "react";
import type { GeneratedDeck } from "@mtg/shared";
import { api } from "../lib/api";

export default function ImportCardsModal({
  deck,
  unownedCount,
  onClose,
  onImported,
}: {
  deck: GeneratedDeck;
  unownedCount: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allCards = deck.cards.map((c) => ({
    name: c.name,
    oracle_id: c.oracle_id,
    count: c.count,
  }));
  const totalCards = allCards.reduce((s, c) => s + c.count, 0);

  async function handleImport(mode: "ignore_duplicates" | "import_all") {
    setImporting(true);
    setError(null);
    try {
      const res = await api.batchAddToCollection(allCards, mode);
      setResult(res);
      if (res.added > 0) {
        onImported();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-white">Import Cards to Collection</h3>

        {result ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-300">
              Added <span className="font-medium text-emerald-400">{result.added}</span> card(s) to your collection.
              {result.skipped > 0 && (
                <> Skipped <span className="text-slate-400">{result.skipped}</span> (already owned or unresolved).</>
              )}
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-400">
              This deck has {totalCards} cards ({unownedCount} not in your collection).
            </p>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleImport("ignore_duplicates")}
                disabled={importing}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {importing ? "Importing…" : `Ignore duplicates (add ~${unownedCount} new)`}
              </button>
              <button
                onClick={() => handleImport("import_all")}
                disabled={importing}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
              >
                {importing ? "Importing…" : `Import all (add ${totalCards})`}
              </button>
            </div>
            <button
              onClick={onClose}
              disabled={importing}
              className="w-full rounded-lg px-4 py-2 text-sm text-slate-500 transition hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
