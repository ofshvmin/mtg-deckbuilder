import { useState } from "react";
import type { BriefDeckResponse } from "@mtg/shared";
import CardDetailModal, { type CardModalData } from "./CardDetailModal";

export interface BriefTurn {
  role: "user" | "assistant";
  text: string;
}

// Shows the AI-brief conversation (your requests + Claude's rationales), the
// current build knobs and core cards, and a refine box to keep iterating.
export default function AiPlanPanel({
  result,
  conversation,
  onRefine,
  refining,
}: {
  result: BriefDeckResponse;
  conversation: BriefTurn[];
  onRefine: (text: string) => void;
  refining: boolean;
}) {
  const [modal, setModal] = useState<CardModalData | null>(null);
  const [refineText, setRefineText] = useState("");
  const { core_cards, spec } = result;

  const chips: string[] = [];
  if (spec.strategy) chips.push(spec.strategy);
  if (spec.theme) chips.push(`theme: ${spec.theme}`);
  if (spec.avoid_combos) chips.push("no combos");
  if (spec.land_count) chips.push(`${spec.land_count} lands`);

  function submit() {
    const t = refineText.trim();
    if (!t || refining) return;
    onRefine(t);
    setRefineText("");
  }

  return (
    <div className="space-y-3 rounded-2xl border border-indigo-800/50 bg-indigo-950/20 p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-indigo-300">
        ✨ Claude's plan
      </div>

      {/* Conversation transcript */}
      <div className="space-y-2">
        {conversation.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="text-sm">
              <span className="font-medium text-indigo-300">You:</span>{" "}
              <span className="text-slate-300">{m.text}</span>
            </div>
          ) : (
            <p key={i} className="text-sm leading-relaxed text-slate-300">
              {m.text}
            </p>
          ),
        )}
        {refining && <p className="text-sm italic text-slate-500">Claude is adjusting the deck…</p>}
      </div>

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

      {/* Refine box */}
      <div className="flex flex-wrap gap-2 border-t border-indigo-900/40 pt-3">
        <input
          type="text"
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Refine — e.g. lower the curve, cut the combos, more card draw, tighter budget"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
        />
        <button
          onClick={submit}
          disabled={refining || !refineText.trim()}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {refining ? "Refining…" : "Refine"}
        </button>
      </div>

      {modal && <CardDetailModal card={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
