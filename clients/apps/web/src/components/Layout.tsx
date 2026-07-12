import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useOutletContext } from "react-router-dom";
import type { CollectionSummary } from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import Logo from "./Logo";

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
  "rounded-md px-3 py-1.5 text-sm font-medium transition " +
  (isActive
    ? "bg-slate-800 text-slate-100"
    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200");

export default function Layout() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close the account menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const ctx: LayoutContext = { summary, refreshSummary, savedCount, refreshSaved };
  const initial = (user?.email?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            {/* Brand — clickable, returns home */}
            <Link to="/" className="group flex items-center gap-2.5" title="Home">
              <Logo className="h-7 w-7 text-[#d8b25c] transition group-hover:text-[#e6c877]" />
              <span className="font-serif text-lg font-semibold tracking-tight text-slate-100 group-hover:text-white">
                Grimoire
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              <NavLink to="/collection" className={navClass}>
                Collection
              </NavLink>
              <NavLink to="/build" className={navClass}>
                Build
              </NavLink>
              <NavLink to="/decks" className={navClass}>
                Saved Decks
                {savedCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-700/70 px-1.5 py-0.5 text-xs tabular-nums text-slate-300">
                    {savedCount}
                  </span>
                )}
              </NavLink>
            </nav>
          </div>

          {/* Account menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-slate-200 ring-1 ring-slate-700 transition hover:ring-slate-500"
              title={user?.email}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {initial}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-xl"
              >
                <div className="truncate border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
                  Signed in as
                  <div className="truncate text-sm text-slate-200">{user?.email}</div>
                </div>
                <Link
                  to="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800"
                  role="menuitem"
                >
                  ⚙ Settings
                </Link>
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-slate-800"
                  role="menuitem"
                >
                  ↪ Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
