import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Combo, GeneratedDeck } from "@mtg/shared";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { formatColorIdentity } from "../lib/format";
import BracketBadge from "./BracketBadge";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";
import CardHoverPreview, { useCardHover } from "./CardHoverPreview";
import CommanderArt from "./CommanderArt";
import DeckCardList from "./DeckCardList";
import DeckComboFinishers from "./DeckComboFinishers";
import DeckUpgrades from "./DeckUpgrades";
import ManaCurve from "./ManaCurve";
import StatTile from "./StatTile";

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
  deck: initialDeck,
  deckName,
  deckId,
  onSaved,
  onEdit,
}: {
  deck: GeneratedDeck;
  deckName?: string;
  deckId?: string;
  onSaved?: () => void;
  onEdit?: (deck: GeneratedDeck) => void;
}) {
  const { user } = useAuth();
  const maxPrice = user?.preferences?.max_card_price ?? null;
  // The deck is held in local state so "Regenerate unlocked" can replace it.
  const [deck, setDeck] = useState<GeneratedDeck>(initialDeck);
  const [name, setName] = useState(deckName ?? `${initialDeck.commander.name} Deck`);
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(deckName ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<string>("Moxfield");
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);            // unsaved regenerate changes
  const [regenerating, setRegenerating] = useState(false);
  const [locked, setLocked] = useState<Set<string>>(new Set());

  // Sync when the parent hands us a different deck (e.g. opening another saved deck).
  useEffect(() => {
    setDeck(initialDeck);
    setLocked(new Set());
    setDirty(false);
  }, [initialDeck]);

  function toggleLock(oracleId: string) {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(oracleId)) next.delete(oracleId);
      else next.add(oracleId);
      return next;
    });
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setSaveError(null);
    try {
      const opts: { locked: string[]; strategy?: string; theme?: string } = {
        locked: [...locked],
      };
      if (deck.strategy && deck.strategy !== "Balanced") opts.strategy = deck.strategy;
      if (deck.theme) opts.theme = deck.theme;
      const next = await api.generateDeck(deck.commander.name, opts);
      setDeck(next);
      setDirty(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to regenerate deck");
    } finally {
      setRegenerating(false);
    }
  }

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
      setDirty(false);
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
          disabled={saving || !name.trim() || (!isUnsaved && !nameChanged && !dirty)}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving
            ? "Saving…"
            : isUnsaved
              ? "Save deck"
              : nameChanged || dirty
                ? "Update deck"
                : "Saved"}
        </button>
        {onEdit && (
          <button
            onClick={() => onEdit(deck)}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Edit cards
          </button>
        )}
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

      {/* Estimated power bracket */}
      {deck.bracket && (
        <div>
          <BracketBadge bracket={deck.bracket} />
        </div>
      )}

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

      {/* Regenerate toolbar: pin cards to keep, reroll the rest */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/60 bg-slate-900/30 px-4 py-2">
        <span className="text-xs text-slate-500">
          📌 Pin cards to keep, then regenerate to rebuild the rest around them.
          {locked.size > 0 && (
            <span className="ml-1 text-amber-400">{locked.size} locked</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {locked.size > 0 && (
            <button
              onClick={() => setLocked(new Set())}
              className="text-xs text-slate-500 transition hover:text-slate-300"
            >
              Clear pins
            </button>
          )}
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-900/30 disabled:opacity-50"
          >
            {regenerating
              ? "Regenerating…"
              : locked.size > 0
                ? `🎲 Regenerate (keep ${locked.size})`
                : "🎲 Regenerate deck"}
          </button>
        </div>
      </div>

      {/* Featured deck list (left) + combos as blocks (right) */}
      <div className={hasCombos ? "grid gap-6 lg:grid-cols-3" : ""}>
        <div className={hasCombos ? "lg:col-span-2" : ""}>
          <DeckCardList
            cards={deck.cards}
            locked={locked}
            onToggleLock={toggleLock}
            columnsClassName={hasCombos ? "columns-1 sm:columns-2" : "columns-1 sm:columns-2 lg:columns-3"}
          />
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

      {/* Combo finishers — cards that complete a combo with this deck */}
      <DeckComboFinishers
        commanderName={deck.commander.name}
        deckCardIds={deck.cards.map((c) => c.oracle_id)}
        maxPrice={maxPrice}
      />

      {/* Budget upgrades — cards you don't own that EDHREC recommends */}
      <DeckUpgrades
        commanderName={deck.commander.name}
        deckCardIds={deck.cards.map((c) => c.oracle_id)}
        maxPrice={maxPrice}
      />

      {/* How this was built — de-emphasized footer */}
      <div className="rounded-lg border border-slate-800/60 bg-slate-900/30 p-3 text-xs leading-relaxed text-slate-500">
        <span className="font-medium text-slate-400">How this was built:</span>{" "}
        {deck.strategy && (
          <>
            <span className="text-sky-400">{deck.strategy}</span> strategy
            {deck.theme ? ", " : ". "}
          </>
        )}
        {deck.theme && (
          <>
            <span className="text-amber-400">{deck.theme}</span> theme
            {deck.theme_count != null && deck.theme_count > 0
              ? ` (${deck.theme_count} of ${deck.nonland_count} nonlands match)`
              : deck.theme_count === 0
                ? " (no cards in your pool matched this theme)"
                : ""}
            .{" "}
          </>
        )}
        {deck.edhrec_available ? (
          <>
            {!deck.strategy && !deck.theme && "C"}
            {(deck.strategy || deck.theme) && "c"}ards fill role quotas and the mana curve, ranked by{" "}
            <span className="text-emerald-500">EDHREC</span> — how often the playerbase runs each
            card with this commander. <span className="text-emerald-500">◆</span> = high-synergy
            pick; <span className="text-fuchsia-500">⚡</span> = part of a combo.
          </>
        ) : (
          <>
            {!deck.strategy && !deck.theme && "C"}
            {(deck.strategy || deck.theme) && "c"}ards fill role quotas and the mana curve, ranked by curve fit and efficiency (no EDHREC
            data for this commander).
          </>
        )}
      </div>
    </div>
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

  const [modal, setModal] = useState<CardModalData | null>(null);
  const { hover, onEnter, onLeave } = useCardHover();

  return (
    <>
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
                {combo.cards.map((cardName, i) => (
                  <span key={cardName}>
                    {i > 0 && " + "}
                    <span
                      className="cursor-pointer hover:text-emerald-300"
                      onClick={() => setModal({ name: cardName })}
                      onMouseEnter={(e) => onEnter(e, cardName)}
                      onMouseLeave={onLeave}
                    >
                      {cardName}
                    </span>
                  </span>
                ))}
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

      {hover && createPortal(
        <CardHoverPreview
          name={hover.name}
          printing={hover.printing}
          anchorRect={hover.rect}
        />,
        document.body,
      )}

      {modal && (
        <CardDetailModal card={modal} onClose={() => setModal(null)} />
      )}
    </>
  );
}
