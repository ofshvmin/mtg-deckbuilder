import { useCallback, useEffect, useState } from "react";
import type { CollectionCard } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import AddCardSearch from "../components/AddCardSearch";
import CollectionGrid from "../components/CollectionGrid";
import ExportCollection from "../components/ExportCollection";
import ImportCollection from "../components/ImportCollection";

type Panel = "import" | "export" | "add" | null;

const PANELS: { key: Exclude<Panel, null>; label: string }[] = [
  { key: "import", label: "Import" },
  { key: "export", label: "Export" },
  { key: "add", label: "Add card" },
];

export default function CollectionPage() {
  const { summary, refreshSummary } = useLayout();
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<Panel>(null);

  const loadCards = useCallback(() => {
    api
      .listCollectionCards()
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(loadCards, [loadCards]);

  const refreshAll = useCallback(() => {
    refreshSummary();
    loadCards();
  }, [refreshSummary, loadCards]);

  // First-time state: no collection yet.
  if (summary && !summary.has_collection) {
    return (
      <div className="mx-auto max-w-xl">
        <ImportCollection onImported={refreshAll} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Collection</h1>
        {summary && (
          <span className="text-sm text-slate-400">
            {summary.unique_cards.toLocaleString()} unique · {summary.total_cards.toLocaleString()} cards
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {PANELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActivePanel(activePanel === key ? null : key)}
            className={`rounded-lg border px-4 py-2 text-sm transition ${
              activePanel === key
                ? "border-emerald-600 bg-emerald-600/10 text-emerald-400"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activePanel === "import" && (
        <div className="max-w-xl">
          <ImportCollection onImported={refreshAll} onClose={() => setActivePanel(null)} hasCollection />
        </div>
      )}
      {activePanel === "export" && (
        <div className="max-w-xl">
          <ExportCollection onClose={() => setActivePanel(null)} />
        </div>
      )}
      {activePanel === "add" && (
        <div className="max-w-xl">
          <AddCardSearch onAdded={refreshAll} onClose={() => setActivePanel(null)} />
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Loading your collection…</p>
      ) : (
        <CollectionGrid cards={cards} onChanged={refreshAll} />
      )}
    </div>
  );
}
