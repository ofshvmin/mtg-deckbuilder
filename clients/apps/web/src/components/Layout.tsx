import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import type { CollectionSummary } from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

export interface LayoutContext {
  summary: CollectionSummary | null;
  refreshSummary: () => void;
  savedCount: number;
  refreshSaved: () => void;
}

/** Shared context for the routed pages (collection summary + saved-deck count). */
export function useLayout(): LayoutContext {
  return useOutletContext<LayoutContext>();
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  "rounded-md px-3 py-1.5 text-sm transition " +
  (isActive
    ? "bg-slate-800 text-slate-100"
    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200");

export default function Layout() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const refreshSummary = useCallback(() => {
    api.collectionSummary().then(setSummary).catch(() => setSummary(null));
  }, []);
  const refreshSaved = useCallback(() => {
    api
      .listSavedDecks()
      .then((d) => setSavedCount(d.length))
      .catch(() => setSavedCount(0));
  }, []);

  useEffect(() => {
    refreshSummary();
    refreshSaved();
  }, [refreshSummary, refreshSaved]);

  const hasCollection = summary?.has_collection;
  const ctx: LayoutContext = { summary, refreshSummary, savedCount, refreshSaved };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold tracking-tight">MTG Deck Builder</h1>
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navClass}>
                Collection
              </NavLink>
              <NavLink to="/build" className={navClass}>
                Build
              </NavLink>
              <NavLink to="/decks" className={navClass}>
                Saved Decks
                {savedCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-800 px-1.5 py-0.5 text-xs tabular-nums text-slate-400">
                    {savedCount}
                  </span>
                )}
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {hasCollection && summary && (
              <span className="hidden text-slate-400 sm:inline">
                {summary.unique_cards.toLocaleString()} unique ·{" "}
                {summary.total_cards.toLocaleString()} cards
              </span>
            )}
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                "rounded-lg px-2 py-1.5 transition " +
                (isActive ? "text-slate-100" : "text-slate-400 hover:text-slate-200")
              }
              title="Settings"
            >
              ⚙ Settings
            </NavLink>
            <span className="hidden text-slate-500 sm:inline">{user?.email}</span>
            <button
              onClick={() => logout()}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 transition hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
