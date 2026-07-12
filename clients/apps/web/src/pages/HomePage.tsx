import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SavedDeckSummary } from "@mtg/shared";
import { api } from "../lib/api";
import { useLayout } from "../components/Layout";
import { useAuth } from "../auth/AuthContext";
import { formatColorIdentity } from "../lib/format";
import BracketBadge from "../components/BracketBadge";
import CommanderArt from "../components/CommanderArt";
import ImportCollection from "../components/ImportCollection";
import StatTile from "../components/StatTile";

function ActionCard({ to, icon, title, sub, primary = false }: {
  to: string; icon: string; title: string; sub: string; primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={
        "group flex flex-col justify-between rounded-2xl border p-5 transition " +
        (primary
          ? "border-emerald-600/50 bg-emerald-600/10 hover:bg-emerald-600/20"
          : "border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900")
      }
    >
      <div className="text-2xl">{icon}</div>
      <div className="mt-6">
        <div className={"text-base font-semibold " + (primary ? "text-emerald-300" : "text-slate-100")}>
          {title} <span className="transition group-hover:translate-x-0.5 inline-block">→</span>
        </div>
        <div className="mt-0.5 text-sm text-slate-400">{sub}</div>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const { summary, refreshSummary, savedCount } = useLayout();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [recent, setRecent] = useState<SavedDeckSummary[]>([]);

  useEffect(() => {
    api
      .listSavedDecks()
      .then((d) =>
        setRecent([...d].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 4)),
      )
      .catch(() => setRecent([]));
  }, []);

  const greeting = user?.email ? user.email.split("@")[0] : "there";

  // Onboarding: no collection yet.
  if (summary && !summary.has_collection) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Welcome to Grimoire</h1>
          <p className="mt-1 text-slate-400">
            Import your collection to start building Commander decks from cards you own.
          </p>
        </div>
        <ImportCollection onImported={refreshSummary} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {greeting}</h1>
        <p className="mt-1 text-slate-400">Pick up where you left off, or start something new.</p>
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ActionCard to="/build" icon="⚡" title="Build a deck" sub="Auto-build or craft one by hand" primary />
        <ActionCard to="/collection" icon="🗂️" title="Browse collection" sub="View and manage your cards" />
        <ActionCard to="/collection" icon="⬆️" title="Import / update" sub="Add cards from a CSV or Excel export" />
      </div>

      {/* At-a-glance stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Unique cards" value={(summary?.unique_cards ?? 0).toLocaleString()} />
        <StatTile label="Total cards" value={(summary?.total_cards ?? 0).toLocaleString()} />
        <StatTile label="Saved decks" value={savedCount} />
      </div>

      {/* Recent decks */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your recent decks</h2>
          {recent.length > 0 && (
            <Link to="/decks" className="text-sm text-emerald-400 hover:text-emerald-300">
              All decks →
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
            No saved decks yet.{" "}
            <Link to="/build" className="text-emerald-400 hover:text-emerald-300">Build your first deck →</Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((d) => (
              <button
                key={d.id}
                onClick={() => navigate("/decks", { state: { openDeckId: d.id } })}
                className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 text-left transition hover:border-slate-700"
              >
                <CommanderArt name={d.commander_name} className="h-40">
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
                  {d.bracket != null && (
                    <div className="absolute right-2 top-2">
                      <BracketBadge compact bracket={{ bracket: d.bracket, label: d.bracket_label ?? "", explanation: "", signals: [] }} />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-2.5">
                    <h3 className="truncate text-sm font-semibold text-white drop-shadow transition group-hover:text-emerald-300">
                      {d.name}
                    </h3>
                  </div>
                </CommanderArt>
                <div className="truncate px-3 py-2 text-xs text-slate-400">
                  {d.commander_name} · {formatColorIdentity(d.color_identity)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
