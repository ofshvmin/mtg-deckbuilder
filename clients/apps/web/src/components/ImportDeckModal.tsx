import { useRef, useState } from "react";
import type { ExternalDeckResponse } from "@mtg/shared";
import { api } from "../lib/api";
import { isPremiumRequired } from "../lib/premium";
import { usePremiumUpgrade } from "./PremiumUpgrade";
import { formatColorIdentity } from "../lib/format";

const PLACEHOLDER = `1x Ravos, Soultender (c16) 39 *F* [Commander{top}]
1x Animate Dead (plst) EMA-78 [Enchantment]
10x Swamp (khm) 396 [Land]

…or a plain list:
1 Sol Ring
1 Command Tower`;

/** Strip the extension off a picked file so it can seed the deck name. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

/** Import a decklist (pasted text or an uploaded text/CSV export) as a saved deck.
 *
 *  Two steps on purpose: resolve first, then save. A pasted list is the one
 *  import path where the source isn't authoritative — typos, custom cards and
 *  maybeboards are all normal — so the preview names what didn't land before
 *  anything is written.
 */
export default function ImportDeckModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (deckId: string) => void;
}) {
  const { showUpgrade } = usePremiumUpgrade();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExternalDeckResponse | null>(null);

  async function handleFile(file: File) {
    setError(null);
    try {
      // Read through arrayBuffer rather than file.text(): Android's picker hands
      // back a lazy content:// reference that can fail on a deferred read.
      const buf = await file.arrayBuffer();
      const decoded = new TextDecoder().decode(buf);
      if (!decoded.trim()) throw new Error("empty file");
      setText(decoded);
      if (!name.trim()) setName(nameFromFile(file.name));
    } catch {
      setError(
        "Couldn't read that file on this device. Try opening it and pasting the list instead.",
      );
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleResolve() {
    if (!text.trim() || resolving) return;
    setResolving(true);
    setError(null);
    try {
      const res = await api.importDeckList({
        text,
        name: name.trim() || "Imported deck",
      });
      setPreview(res);
      if (!name.trim()) setName(res.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that decklist");
    } finally {
      setResolving(false);
    }
  }

  async function handleSave() {
    if (!preview || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveDeck(name.trim() || preview.name, preview.deck, {
        source: preview.source,
      });
      onSaved(saved.id);
    } catch (e) {
      if (isPremiumRequired(e)) {
        showUpgrade("Unlimited saved decks");
        onClose();
        return;
      }
      setError(e instanceof Error ? e.message : "Could not save the deck");
    } finally {
      setSaving(false);
    }
  }

  const unresolved = preview?.unresolved_names ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Import a deck</h3>
            <p className="mt-1 text-sm text-slate-400">
              Paste a decklist or upload a .txt/.csv export from Moxfield, Archidekt,
              Arena or MTGO.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-slate-500 transition hover:text-slate-300"
            title="Close"
          >
            ✕
          </button>
        </div>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Deck name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Imported deck"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
        />

        {preview ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
              <p className="font-medium text-slate-200">
                {preview.deck.commander?.name ?? "No commander found"}
                {preview.deck.color_identity?.length > 0 && (
                  <span className="ml-2 text-slate-500">
                    {formatColorIdentity(preview.deck.color_identity)}
                  </span>
                )}
              </p>
              <p className="mt-1 text-slate-400">
                {preview.deck.total} cards ·{" "}
                <span className="text-emerald-400">{preview.owned_count} owned</span>
                {preview.unowned_count > 0 && (
                  <span className="text-slate-500"> · {preview.unowned_count} unowned</span>
                )}
              </p>
            </div>

            {preview.deck.warnings?.map((w) => (
              <p key={w} className="text-xs text-amber-400">{w}</p>
            ))}
            {unresolved.length > 0 && (
              <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3">
                <p className="text-xs font-medium text-amber-300">
                  {unresolved.length} name(s) didn't match a card and were left out:
                </p>
                <p className="mt-1 break-words text-xs text-amber-200/80">
                  {unresolved.slice(0, 12).join(", ")}
                  {unresolved.length > 12 && ` … and ${unresolved.length - 12} more`}
                </p>
              </div>
            )}

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save to my decks"}
              </button>
              <button
                onClick={() => { setPreview(null); setError(null); }}
                disabled={saving}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600"
            />
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                accept=".txt,.csv,.dec,.dek,text/plain,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <button
                onClick={() => inputRef.current?.click()}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
              >
                Upload file
              </button>
              <button
                onClick={handleResolve}
                disabled={resolving || !text.trim()}
                className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {resolving ? "Reading…" : "Continue"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
