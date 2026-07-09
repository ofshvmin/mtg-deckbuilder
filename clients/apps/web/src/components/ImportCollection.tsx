import { useRef, useState } from "react";
import type { ImportResult } from "@mtg/shared";
import { api } from "../lib/api";

const FORMAT_OPTIONS = ["Auto-detect", "Moxfield", "Archidekt", "Dragon Shield", "Deckbox", "ManaBox"] as const;
const EXPORT_FORMATS = ["Moxfield", "Archidekt", "Dragon Shield", "Deckbox", "ManaBox"] as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportCollection({
  onImported,
  hasCollection = false,
}: {
  onImported: () => void;
  hasCollection?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [format, setFormat] = useState<string>("Auto-detect");
  const [exportFormat, setExportFormat] = useState<string>("Moxfield");
  const [exporting, setExporting] = useState(false);

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

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.exportCollectionBlob(exportFormat);
      const filename = `collection-${exportFormat.toLowerCase().replace(" ", "-")}.csv`;
      downloadBlob(blob, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
      <h2 className="text-xl font-semibold">
        {hasCollection ? "Update your collection" : "Import your collection"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
        Upload a collection CSV or Excel file from Moxfield, Archidekt, Dragon Shield, Deckbox, or
        ManaBox. Format is auto-detected.
        {hasCollection && " This will replace your current collection."}
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
        className="mt-4 rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Importing…" : "Choose file"}
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

      {hasCollection && (
        <div className="mt-6 border-t border-slate-800 pt-6">
          <p className="text-sm font-medium text-slate-300">Export collection</p>
          <div className="mt-2 flex items-center justify-center gap-3">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
            >
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
            >
              {exporting ? "Exporting…" : "Download CSV"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
