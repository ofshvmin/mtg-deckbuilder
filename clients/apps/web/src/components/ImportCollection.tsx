import { useRef, useState } from "react";
import type { ImportResult } from "@mtg/shared";
import { api } from "../lib/api";

const FORMAT_OPTIONS = ["Auto-detect", "Moxfield", "Archidekt", "Dragon Shield", "Deckbox", "ManaBox"] as const;

export default function ImportCollection({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [format, setFormat] = useState<string>("Auto-detect");

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fmt = format === "Auto-detect" ? undefined : format;
      const res = await api.importCollection(file, file.name, fmt);
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
        Upload a collection CSV from Moxfield, Archidekt, Dragon Shield, Deckbox, or ManaBox.
        Format is auto-detected.
      </p>

      <div className="mx-auto mt-4 flex items-center justify-center gap-3">
        <label htmlFor="csv-format" className="text-sm text-slate-400">Format:</label>
        <select
          id="csv-format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

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
        className="mt-4 rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Importing…" : "Choose CSV file"}
      </button>

      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}
      {result && (
        <p className="mt-4 text-sm text-emerald-400">
          Imported {result.total.toLocaleString()} rows
          {result.detected_format ? ` (${result.detected_format})` : ""} —{" "}
          {result.matched.toLocaleString()} matched, {result.unmatched.toLocaleString()} unmatched ·{" "}
          {result.unique_owned.toLocaleString()} unique cards.
        </p>
      )}
    </div>
  );
}
