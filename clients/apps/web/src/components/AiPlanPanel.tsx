import { useState } from "react";
import type { BriefDeckResponse } from "@mtg/shared";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";

// Shows Claude's rationale for an AI-brief build, the knobs it set, and the
// core cards it anchored the deck on (click to inspect).
export default function AiPlanPanel({ result }: { result: BriefDeckResponse }) {
  const [modal, setModal] = useState<CardModalData | null>(null);
  const { rationale, core_cards, spec } = result;

  const chips: string[] = [];
  if (spec.strategy) chips.push(spec.strategy);
  if (spec.theme) chips.push(`theme: ${spec.theme}`);
  if (spec.avoid_combos) chips.push("no combos");
  if (spec.land_count) chips.push(`${spec.land_count} lands`);

  return (
    <div className="space-y-3 rounded-2xl border border-indigo-800/50 bg-indigo-950/20 p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-indigo-300">
        ✨ Claude's plan
      </div>
      {rationale && <p className="text-sm leading-relaxed text-slate-300">{rationale}</p>}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
              {c}
            </span>
          ))}
        </div>
      )}

      {core_cards.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">
            Core cards ({core_cards.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {core_cards.map((c) => (
              <button
                key={c.oracle_id}
                onClick={() =>
                  setModal({
                    oracle_id: c.oracle_id,
                    name: c.name,
                    mana_cost: c.mana_cost,
                    cmc: c.cmc,
                    type_line: c.type_line,
                    color_identity: c.color_identity,
                    oracle_text: c.oracle_text,
                  })
                }
                className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 transition hover:border-emerald-600 hover:text-emerald-300"
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {modal && <CardDetailModal card={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
