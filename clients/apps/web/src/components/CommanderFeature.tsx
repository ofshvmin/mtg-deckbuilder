import { useEffect, useState } from "react";
import type { Color } from "@mtg/shared";
import { cheapestPrint, fetchCardDetail, type CardDetail } from "../lib/scryfallPrints";
import CardImage from "./CardImage";
import ColorPips from "./ColorPips";
import ManaCost from "./ManaCost";

// A featured commander card: full card image + its details (type, mana cost,
// color identity, oracle text) and market price. Reused on the Build page
// (commander selected) and the saved-deck view. Renders known fields
// immediately and fills price/oracle text from Scryfall.
export default function CommanderFeature({
  name,
  oracleId,
  colorIdentity,
  typeLine,
  manaCost,
  oracleText,
}: {
  name: string;
  oracleId?: string;
  colorIdentity?: Color[];
  typeLine?: string;
  manaCost?: string;
  oracleText?: string;
}) {
  const [detail, setDetail] = useState<CardDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCardDetail({ oracleId, name }).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => { cancelled = true; };
  }, [oracleId, name]);

  const cheapest = detail ? cheapestPrint(detail.prints) : undefined;
  const price = cheapest?.priceUsd;
  const type = typeLine || detail?.typeLine;
  const mana = manaCost || detail?.manaCost;
  const text = oracleText || detail?.oracleText;

  // Use the newest printing's set+collector for a reliable direct image URL
  // (the name-lookup endpoint redirects and is rate-limit-prone).
  const art = detail?.prints?.[0];
  const printing = art
    ? {
        printing_key: `feature:${art.set}:${art.collectorNumber}`,
        edition: art.set,
        collector_number: art.collectorNumber,
        finish: "nonfoil",
        condition: null,
        language: null,
        count: 0,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:flex-row">
      <div className="w-44 shrink-0 self-center sm:self-start">
        <CardImage
          printing={printing}
          name={name}
          typeLine={type}
          manaCost={mana}
          className="aspect-[745/1040] w-full shadow-lg ring-1 ring-black/40"
        />
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">{name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
            {type && <span>{type}</span>}
            {mana && <ManaCost cost={mana} className="text-sm" />}
            {colorIdentity && colorIdentity.length > 0 && <ColorPips colors={colorIdentity} />}
          </div>
        </div>

        <div className="text-sm">
          <span className="text-slate-500">Market price </span>
          <span className="font-semibold tabular-nums text-emerald-300">
            {price != null ? `~$${price.toFixed(2)}` : detail ? "—" : "…"}
          </span>
        </div>

        {text && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{text}</p>
        )}
      </div>
    </div>
  );
}
