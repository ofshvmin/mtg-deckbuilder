import type { DeckCard, GeneratedDeck } from "@mtg/shared";
import { formatManaCost } from "../lib/format";
import ManaCurve from "./ManaCurve";
import StatTile from "./StatTile";

// Slot display order + labels.
const SLOTS: { key: string; label: string }[] = [
  { key: "land", label: "Lands" },
  { key: "ramp", label: "Ramp" },
  { key: "card_draw", label: "Card Draw" },
  { key: "removal", label: "Removal" },
  { key: "board_wipe", label: "Board Wipes" },
  { key: "game_plan", label: "Game Plan" },
];

export default function DeckView({ deck }: { deck: GeneratedDeck }) {
  const bySlot = (slot: string) => deck.cards.filter((c) => c.slot === slot);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Deck size" value={`${deck.total} + CMD`} />
        <StatTile label="Lands" value={deck.land_count} />
        <StatTile label="Avg nonland MV" value={deck.stats.avg_nonland_mv ?? "—"} />
        <StatTile label="2+ lands (opener)" value={`${deck.stats.p_2plus_lands_opening ?? "—"}%`} />
      </div>

      {deck.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-4 text-sm text-amber-300">
          {deck.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        <span className="font-medium text-slate-300">How this was built:</span>{" "}
        {deck.edhrec_available ? (
          <>
            cards fill role quotas and the mana curve, ranked by{" "}
            <span className="text-emerald-400">EDHREC</span> — how often the playerbase runs each
            card with this commander. The <span className="text-emerald-400">◆</span> marks
            high-synergy picks. (Combo detection arrives next.)
          </>
        ) : (
          <>cards fill role quotas and the mana curve, ranked by curve fit and efficiency (no
            EDHREC data for this commander).</>
        )}
      </div>

      <ManaCurve curve={deck.curve} />

      <div className="grid gap-4 md:grid-cols-2">
        {SLOTS.map(({ key, label }) => {
          const cards = bySlot(key);
          if (cards.length === 0) return null;
          const total = cards.reduce((s, c) => s + c.count, 0);
          return (
            <div key={key} className="rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
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
  );
}

function DeckRow({ card }: { card: DeckCard }) {
  const highSynergy = card.quality >= 0.3;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
      <span className="text-slate-200">
        {card.count > 1 && <span className="mr-1 text-slate-500">{card.count}×</span>}
        {card.name}
        {highSynergy && (
          <span
            className="ml-1.5 text-emerald-400"
            title={`High synergy with this commander (EDHREC score ${card.quality.toFixed(2)})`}
          >
            ◆
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-xs text-slate-500">
        {formatManaCost(card.mana_cost)}
      </span>
    </li>
  );
}
