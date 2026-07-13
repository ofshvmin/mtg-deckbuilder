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

  const [mobileNav, setMobileNav] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4 sm:gap-6">
            <Link to="/" className="group flex items-center gap-2" title="Home">
              <Logo className="h-7 w-7 text-[#d8b25c] transition group-hover:text-[#e6c877]" />
              <span className="hidden font-serif text-lg font-semibold tracking-tight text-slate-100 group-hover:text-white sm:inline">
                Grimoire
              </span>
            </Link>
            {/* Desktop nav */}
            <nav className="hidden items-center gap-1 sm:flex">
              <NavLink to="/collection" className={navClass}>Collection</NavLink>
              <NavLink to="/build" className={navClass}>Build</NavLink>
              <NavLink to="/decks" className={navClass}>
                Decks
                {savedCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-700/70 px-1.5 py-0.5 text-xs tabular-nums text-slate-300">
                    {savedCount}
                  </span>
                )}
              </NavLink>
            </nav>
            {/* Mobile hamburger */}
            <button onClick={() => setMobileNav((o) => !o)}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 sm:hidden"
              aria-label="Menu">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {mobileNav
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>
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
              <div role="menu"
                className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-xl sm:w-56">
                <div className="truncate border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
                  Signed in as
                  <div className="truncate text-sm text-slate-200">{user?.email}</div>
                </div>
                <Link to="/settings" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800" role="menuitem">
                  Settings
                </Link>
                <button onClick={() => { setMenuOpen(false); logout(); }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-slate-800" role="menuitem">
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileNav && (
          <nav className="flex flex-col border-t border-slate-800 px-4 py-2 sm:hidden">
            <NavLink to="/collection" className={navClass} onClick={() => setMobileNav(false)}>Collection</NavLink>
            <NavLink to="/build" className={navClass} onClick={() => setMobileNav(false)}>Build</NavLink>
            <NavLink to="/decks" className={navClass} onClick={() => setMobileNav(false)}>
              Decks {savedCount > 0 && `(${savedCount})`}
            </NavLink>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
