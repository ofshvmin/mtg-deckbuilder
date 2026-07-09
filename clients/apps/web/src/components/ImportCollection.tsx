import { useRef, useState } from "react";
import type { ImportResult } from "@mtg/shared";
import { api } from "../lib/api";

const FORMAT_OPTIONS = ["Auto-detect", "Moxfield", "Archidekt", "Dragon Shield", "Deckbox", "ManaBox"] as const;

export default function ImportCollection({
  onImported,
  onClose,
  hasCollection = false,
}: {
  onImported: () => void;
  onClose?: () => void;
  hasCollection?: boolean;
}) {
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-200">
          {hasCollection ? "Replace collection" : "Import collection"}
        </h3>
        {onClose && (
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Upload a CSV or Excel file from Moxfield, Archidekt, Dragon Shield, Deckbox, or ManaBox.
        {hasCollection && " This will replace your current collection."}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Importing…" : "Choose file"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      {result && (
        <p className="mt-2 text-sm text-emerald-400">
          Imported {result.total.toLocaleString()} rows
          {result.detected_format ? ` (${result.detected_format})` : ""} —{" "}
          {result.matched.toLocaleString()} matched, {result.unmatched.toLocaleString()} unmatched ·{" "}
          {result.unique_owned.toLocaleString()} unique cards.
        </p>
      )}
    </div>
  );
}
