import { useMemo, useState } from "react";
import type { DeckCard } from "@mtg/shared";
import { buyList, buyListText } from "@mtg/shared";

// "Cards to buy": the deck's cards you don't have, as a list to paste into
// TCGplayer's Mass Entry or Card Kingdom's deck builder. Hidden when you own
// everything.

const STORES = [
  { name: "TCGplayer Mass Entry", url: "https://www.tcgplayer.com/massentry" },
  { name: "Card Kingdom Deck Builder", url: "https://www.cardkingdom.com/builder" },
];

export default function BuyListButton({
  cards,
  ownershipKnown,
}: {
  cards: DeckCard[];
  /** True when every card was checked against the collection (imports, Explore). */
  ownershipKnown: boolean;
}) {
  const lines = useMemo(() => buyList(cards, ownershipKnown), [cards, ownershipKnown]);
  const text = useMemo(() => buyListText(lines), [lines]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (lines.length === 0) return null;
  const total = lines.reduce((n, l) => n + l.count, 0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the list is selectable in the panel instead.
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void copy();
        }}
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 sm:text-sm sm:py-2"
        title="Copy the cards you don't own, ready for a store's bulk purchase box"
      >
        Cards to buy ({total})
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-80 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {copied ? "Copied to clipboard" : `${total} cards · ${lines.length} different`}
            </span>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300" aria-label="Close">
              ✕
            </button>
          </div>
          <textarea
            readOnly
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            rows={Math.min(10, lines.length)}
            className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-300"
          />
          <button
            onClick={copy}
            className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            {copied ? "✓ Copied" : "Copy list"}
          </button>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Paste into{" "}
            {STORES.map((s, i) => (
              <span key={s.url}>
                {i > 0 && " or "}
                <a href={s.url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                  {s.name}
                </a>
              </span>
            ))}
            . Basic lands are left off.
          </p>
        </div>
      )}
    </div>
  );
}
