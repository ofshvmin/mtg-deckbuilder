import { useEffect, useRef, useState } from "react";
import { ApiError, type ImportResult } from "@mtg/shared";
import { api } from "../lib/api";

const FORMAT_OPTIONS = ["Auto-detect", "Moxfield", "Archidekt", "Dragon Shield", "Deckbox", "ManaBox"] as const;

// The API runs on a scale-to-zero Fly machine (min_machines_running=0) that
// autostops ~1 min after the last request. On mobile, picking a file can take
// long enough for it to sleep, so the upload lands on a cold-starting machine
// and fails with a raw network error ("Failed to fetch"). We can't keep the
// machine warm for free, so instead: nudge it awake early, and — because a
// failed request is itself what tells Fly to boot — retry the upload a few
// times. Import is an idempotent "replace collection", so retrying is safe.
const RETRY_DELAYS_MS = [1500, 3000, 4500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fire-and-forget wake-up so the machine boots while the user picks a file. */
function wakeServer() {
  api.health().catch(() => {});
}

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
  const [status, setStatus] = useState<string>("Choose file");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [format, setFormat] = useState<string>("Auto-detect");

  // Start waking the (scale-to-zero) API as soon as the panel opens.
  useEffect(() => {
    wakeServer();
  }, []);

  async function handleFile(file: File) {
    if (busy) return; // prevent double-submit
    setBusy(true);
    setError(null);
    setResult(null);

    // Read the file into memory *now*, while the picker's access grant is fresh.
    // Android's picker often returns a lazy content:// reference that fetch can't
    // read later (it throws "Failed to fetch" before sending anything). Passing
    // an in-memory Blob to the upload sidesteps that deferred read entirely.
    let blob: Blob;
    try {
      const buf = await file.arrayBuffer();
      if (buf.byteLength === 0) throw new Error("empty file");
      blob = new Blob([buf], { type: file.type || "text/csv" });
    } catch {
      setError(
        "Couldn't read that file on this device. Try saving it to your device " +
          "(e.g. the Downloads folder) and selecting it again.",
      );
      setStatus("Choose file");
      setBusy(false);
      // Reset file input so re-selecting the same file triggers onChange
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const fmt = format === "Auto-detect" ? undefined : format;
    const attempts = RETRY_DELAYS_MS.length + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      setStatus(attempt === 0 ? "Importing…" : "Server was asleep — retrying…");
      try {
        const res = await api.importCollection(blob, file.name, fmt);
        setResult(res);
        onImported();
        break;
      } catch (e) {
        // A real HTTP error (ApiError, e.g. a 400 for an unrecognized format) is
        // a genuine failure — surface it, don't retry. A bare network error
        // (TypeError: "Failed to fetch") means the request never reached the
        // app, almost always a cold start; retry after a short backoff.
        const isNetworkError = !(e instanceof ApiError);
        if (isNetworkError && attempt < attempts - 1) {
          wakeServer();
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        setError(
          isNetworkError
            ? "Couldn't reach the server (it may have been waking up). Please try again."
            : e instanceof Error
              ? e.message
              : "Import failed",
        );
        break;
      }
    }

    setStatus("Choose file");
    setBusy(false);
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
          onClick={() => {
            wakeServer();
            inputRef.current?.click();
          }}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {status}
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
