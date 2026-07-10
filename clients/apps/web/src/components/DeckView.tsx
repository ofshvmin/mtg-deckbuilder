import { useState } from "react";
import type { Combo, DeckCard, GeneratedDeck } from "@mtg/shared";
import { api } from "../lib/api";
import { formatColorIdentity, formatManaCost } from "../lib/format";
import CommanderArt from "./CommanderArt";
import ManaCurve from "./ManaCurve";
import PrintingChips from "./PrintingChips";
import StatTile from "./StatTile";

// Slot display order + labels + an accent dot for visual grouping.
const SLOTS: { key: string; label: string; dot: string }[] = [
  { key: "land", label: "Lands", dot: "bg-amber-500" },
  { key: "ramp", label: "Ramp", dot: "bg-emerald-500" },
  { key: "card_draw", label: "Card Draw", dot: "bg-sky-500" },
  { key: "removal", label: "Removal", dot: "bg-rose-500" },
  { key: "board_wipe", label: "Board Wipes", dot: "bg-red-600" },
  { key: "game_plan", label: "Game Plan", dot: "bg-fuchsia-500" },
];

const EXPORT_FORMATS = ["Moxfield", "Archidekt", "Dragon Shield", "Deckbox", "ManaBox"] as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DeckView({
  deck,
  deckName,
  deckId,
  onSaved,
}: {
  deck: GeneratedDeck;
  deckName?: string;
  deckId?: string;
  onSaved?: () => void;
}) {
  const bySlot = (slot: string) => deck.cards.filter((c) => c.slot === slot);
  const [name, setName] = useState(deckName ?? `${deck.commander.name} Deck`);
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(deckName ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<string>("Moxfield");
  const [exporting, setExporting] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (deckId) {
        await api.updateSavedDeck(deckId, { name: name.trim(), deck });
      } else {
        await api.saveDeck(name.trim(), deck);
      }
      setSavedAs(name.trim());
      onSaved?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save deck");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (!deckId) return;
    setExporting(true);
    try {
      const blob = await api.exportDeckBlob(deckId, exportFormat);
      const safeName = (savedAs || name).replace(/\s+/g, "-");
      downloadBlob(blob, `${safeName}.csv`);
    } catch {
      // silent
    } finally {
      setExporting(false);
    }
  }

  const nameChanged = savedAs !== null && name.trim() !== savedAs;
  const isUnsaved = savedAs === null;
  const hasCombos = deck.combos.length > 0 || deck.near_combos.length > 0;
  const title = savedAs ?? deckName ?? `${deck.commander.name} Deck`;

  return (
    <div className="space-y-6">
      {/* Hero banner: commander art + deck identity */}
      <div className="overflow-hidden rounded-2xl border border-slate-800">
        <CommanderArt name={deck.commander.name} className="h-48 sm:h-56">
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold text-white drop-shadow sm:text-3xl">
                {title}
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                {deck.commander.name} · {formatColorIdentity(deck.color_identity)} ·{" "}
                {deck.commander.type_line}
              </p>
            </div>
            <div className="hidden shrink-0 rounded-lg bg-black/40 px-3 py-1.5 text-right backdrop-blur sm:block">
              <div className="text-2xl font-bold tabular-nums text-white">{deck.total}</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-300">+ commander</div>
            </div>
          </div>
        </CommanderArt>
      </div>

      {/* Controls: name + save + export */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Deck name"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
        />
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || (!isUnsaved && !nameChanged)}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : isUnsaved ? "Save deck" : nameChanged ? "Update name" : "Saved"}
        </button>
        {deckId && (
          <>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-2 text-sm text-slate-200"
            >
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
            >
              {exporting ? "…" : "Export"}
            </button>
          </>
        )}
      </div>
      {savedAs && !deckName && !nameChanged && (
        <p className="text-sm text-emerald-400">Deck saved as "{savedAs}"</p>
      )}
      {saveError && <p className="text-sm text-rose-400">{saveError}</p>}

      {/* Top-level stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Deck size" value={`${deck.total} + CMD`} />
        <StatTile label="Lands" value={deck.land_count} />
        <StatTile label="Avg nonland MV" value={deck.stats.avg_nonland_mv ?? "—"} />
        <StatTile label="2+ lands (opener)" value={`${deck.stats.p_2plus_lands_opening ?? "—"}%`} />
      </div>

      {/* Mana curve directly under the stats */}
      <ManaCurve curve={deck.curve} />

      {deck.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-4 text-sm text-amber-300">
          {deck.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {/* Featured deck list (left) + combos as blocks (right) */}
      <div className={hasCombos ? "grid gap-6 lg:grid-cols-3" : ""}>
        <div className={hasCombos ? "lg:col-span-2" : ""}>
          <div className="grid gap-4 sm:grid-cols-2">
            {SLOTS.map(({ key, label, dot }) => {
              const cards = bySlot(key);
              if (cards.length === 0) return null;
              const total = cards.reduce((s, c) => s + c.count, 0);
              return (
                <div key={key} className="rounded-xl border border-slate-800 bg-slate-900/60">
                  <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
                    <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-300">
                      <span className={`h-2 w-2 rounded-full ${dot}`} />
                      {label}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">{total}</span>
                  </div>
                  <ul className="divide-y divide-slate-800/60">
                    {cards.map((c) => (
                      <DeckRow key={c.oracle_id} card={c} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {hasCombos && (
          <aside className="space-y-4">
            {deck.combos.length > 0 && (
              <ComboSection
                title={`Combos in this deck (${deck.combos.length})`}
                combos={deck.combos}
                accent="fuchsia"
              />
            )}
            {deck.near_combos.length > 0 && (
              <ComboSection title="One card away" combos={deck.near_combos} accent="amber" near />
            )}
          </aside>
        )}
      </div>

      {/* How this was built — de-emphasized footer */}
      <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-3 text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-400">How this was built:</span>{" "}
        {deck.edhrec_available ? (
          <>
            cards fill role quotas and the mana curve, ranked by{" "}
            <span className="text-emerald-500">EDHREC</span> — how often the playerbase runs each
            card with this commander. <span className="text-emerald-500">◆</span> = high-synergy
            pick; <span className="text-fuchsia-500">⚡</span> = part of a combo.
          </>
        ) : (
          <>cards fill role quotas and the mana curve, ranked by curve fit and efficiency (no EDHREC
            data for this commander).</>
        )}
      </div>
    </div>
  );
}

function DeckRow({ card }: { card: DeckCard }) {
  const highSynergy = card.quality >= 0.3;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-slate-200">
        <span className="truncate">
          {card.count > 1 && <span className="mr-1 text-slate-500">{card.count}×</span>}
          {card.name}
        </span>
        {card.in_combo && (
          <span className="text-fuchsia-400" title="Part of a combo in this deck">
            ⚡
          </span>
        )}
        {highSynergy && (
          <span
            className="text-emerald-400"
            title={`High synergy with this commander (EDHREC score ${card.quality.toFixed(2)})`}
          >
            ◆
          </span>
        )}
        <PrintingChips printings={card.printings} />
      </span>
      <span className="shrink-0 font-mono text-xs text-slate-500">
        {formatManaCost(card.mana_cost)}
      </span>
    </li>
  );
}

function ComboSection({
  title,
  combos,
  accent,
  near = false,
}: {
  title: string;
  combos: Combo[];
  accent: "fuchsia" | "amber";
  near?: boolean;
}) {
  const border = accent === "fuchsia" ? "border-fuchsia-800/40" : "border-amber-800/40";
  const text = accent === "fuchsia" ? "text-fuchsia-300" : "text-amber-300";
  const shown = combos.slice(0, 10);
  return (
    <div className={`rounded-xl border ${border} bg-slate-900/60`}>
      <div className={`border-b ${border} px-4 py-2 text-xs font-medium uppercase tracking-wider ${text}`}>
        {title}
      </div>
      <ul className="divide-y divide-slate-800/60">
        {shown.map((combo) => (
          <li key={combo.id} className="px-4 py-2 text-sm">
            <div className="text-slate-200">
              {near && combo.missing_name && (
                <span className="mr-1 text-amber-400">+ {combo.missing_name}:</span>
              )}
              {combo.cards.join(" + ")}
            </div>
            {combo.produces.length > 0 && (
              <div className="text-xs text-slate-500">→ {combo.produces.join(", ")}</div>
            )}
          </li>
        ))}
      </ul>
      {combos.length > shown.length && (
        <div className="px-4 py-2 text-xs text-slate-500">+ {combos.length - shown.length} more</div>
      )}
    </div>
  );
}
