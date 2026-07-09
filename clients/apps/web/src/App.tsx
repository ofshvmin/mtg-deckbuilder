import { useEffect, useState } from "react";
import type { HealthStatus } from "@mtg/shared";
import { api } from "./lib/api";

// Phase A placeholder: proves the web → @mtg/shared → backend path end-to-end
// by calling /health. Replaced by the real dashboard in Phase D.
export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <h1 className="text-2xl font-semibold tracking-tight">MTG Deck Builder</h1>
        <p className="mt-1 text-sm text-slate-400">
          Full-stack foundation — Phase A scaffold
        </p>

        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Backend health
          </div>
          {error && (
            <p className="mt-2 text-sm text-rose-400">
              Could not reach API: {error}
            </p>
          )}
          {!error && !health && (
            <p className="mt-2 text-sm text-slate-400">Checking…</p>
          )}
          {health && (
            <dl className="mt-2 space-y-1 text-sm">
              <Row label="Status" value={health.status} ok={health.status === "ok"} />
              <Row label="Version" value={health.version} />
              <Row
                label="DB configured"
                value={String(health.db_configured)}
                ok={health.db_configured}
              />
              <Row
                label="DB connected"
                value={String(health.db_connected)}
                ok={health.db_connected}
              />
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-400">{label}</dt>
      <dd
        className={
          ok === undefined
            ? "font-mono text-slate-200"
            : ok
              ? "font-mono text-emerald-400"
              : "font-mono text-amber-400"
        }
      >
        {value}
      </dd>
    </div>
  );
}
