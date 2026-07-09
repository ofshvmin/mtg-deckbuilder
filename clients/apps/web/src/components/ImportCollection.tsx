import { useRef, useState } from "react";
import type { ImportResult } from "@mtg/shared";
import { api } from "../lib/api";

export default function ImportCollection({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.importCollection(file, file.name);
      setResult(res);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
      <h2 className="text-xl font-semibold">Import your collection</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
        Upload a Moxfield-format collection CSV (Count, Name, Edition, Foil, …). We'll match each
        card against the Scryfall database.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-6 rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Importing…" : "Choose CSV file"}
      </button>

      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}
      {result && (
        <p className="mt-4 text-sm text-emerald-400">
          Imported {result.total.toLocaleString()} rows — {result.matched.toLocaleString()} matched,{" "}
          {result.unmatched.toLocaleString()} unmatched · {result.unique_owned.toLocaleString()}{" "}
          unique cards.
        </p>
      )}
    </div>
  );
}
