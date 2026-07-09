import { useState } from "react";
import { api } from "../lib/api";

const EXPORT_FORMATS = ["Moxfield", "Archidekt", "Dragon Shield", "Deckbox", "ManaBox"] as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportCollection({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState("Moxfield");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.exportCollectionBlob(format);
      const filename = `collection-${format.toLowerCase().replace(" ", "-")}.csv`;
      downloadBlob(blob, filename);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-200">Export collection</h3>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
        >
          {EXPORT_FORMATS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Download CSV"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </div>
  );
}
