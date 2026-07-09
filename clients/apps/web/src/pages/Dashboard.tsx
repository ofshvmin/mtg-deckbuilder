import { useEffect, useState } from "react";
import type { HealthStatus } from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

// Phase C placeholder for the authenticated area. Phase D replaces this with the
// real dashboard (commander picker, mana curve, pool table) on live collection data.
export default function Dashboard() {
  const { user, logout } = useAuth();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight">MTG Deck Builder</h1>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-400">{user?.email}</span>
            <button
              onClick={() => logout()}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 transition hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h2 className="text-2xl font-semibold">You're signed in ✓</h2>
        <p className="mt-2 text-slate-400">
          Authentication is wired up end-to-end. The deck-building dashboard lands in Phase D.
        </p>

        <div className="mt-8 inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-sm">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (health?.db_connected ? "bg-emerald-400" : "bg-amber-400")
            }
          />
          <span className="text-slate-300">
            Backend {health?.status ?? "…"} · DB{" "}
            {health?.db_connected ? "connected" : "not connected"}
          </span>
        </div>
      </main>
    </div>
  );
}
