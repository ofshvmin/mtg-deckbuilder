import { useEffect, useMemo, useRef, useState } from "react";
import type { Printing } from "@mtg/shared";
import {
  scryfallImageUrl,
  scryfallNamedImageUrl,
  isDfc,
  type CardFace,
} from "../lib/scryfall";

// A card image with a graceful source chain. When an `imageUrl` is supplied — a
// direct cards.scryfall.io CDN url (e.g. batch-fetched by the deck grid) — it's
// preferred for the front face. The CDN isn't rate-limited, unlike the
// api.scryfall.com image endpoint, so bulk grids no longer drop later cards once
// Scryfall starts throttling a burst of ~99 requests. It falls back to the
// per-printing and named API endpoints, then a text placeholder. `pending` holds
// the skeleton while a parent is still batch-fetching the CDN url, so we don't
// fire the api.scryfall.com request that the batch exists to avoid.
export default function CardImage({
  printing,
  name,
  typeLine,
  manaCost,
  className = "",
  isFoil = false,
  imageUrl,
  pending = false,
}: {
  printing?: Printing;
  name: string;
  typeLine?: string;
  manaCost?: string;
  className?: string;
  isFoil?: boolean;
  imageUrl?: string;
  pending?: boolean;
}) {
  const foil = isFoil || printing?.finish === "foil";
  const dfc = isDfc(typeLine, manaCost);
  const printingKey = printing?.printing_key ?? "named";

  const [face, setFace] = useState<CardFace>("front");
  const [srcIndex, setSrcIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Ordered fallback sources for the current face. The back face has no CDN url,
  // so it goes straight to the API endpoints.
  const sources = useMemo(() => {
    if (face === "back") {
      return [
        scryfallImageUrl(printing, name, "normal", "back"),
        scryfallNamedImageUrl(name, "normal", "back"),
      ];
    }
    const list: string[] = [];
    if (imageUrl) list.push(imageUrl);
    list.push(scryfallImageUrl(printing, name, "normal", "front"));
    list.push(scryfallNamedImageUrl(name, "normal", "front"));
    return [...new Set(list)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, printingKey, name, face]);

  // Restart the source chain whenever the card, face, or resolved url changes.
  useEffect(() => {
    setSrcIndex(0);
    setFailed(false);
    setLoaded(false);
  }, [printingKey, name, face, imageUrl]);

  // Reset to the front face when the printing changes.
  const prevPrintingKey = useRef(printingKey);
  if (prevPrintingKey.current !== printingKey) {
    prevPrintingKey.current = printingKey;
    if (face !== "front") setFace("front");
  }

  function handleError() {
    if (srcIndex < sources.length - 1) {
      setSrcIndex((i) => i + 1);
      setLoaded(false);
    } else {
      setFailed(true);
    }
  }

  function flip() {
    setFace((f) => (f === "front" ? "back" : "front"));
  }

  if (failed) {
    return (
      <div
        className={
          "flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 p-4 text-center text-sm text-slate-500 " +
          className
        }
      >
        No image found for<br />
        <span className="text-slate-300">{name}</span>
        {printing?.edition && (
          <span className="mt-1 text-xs uppercase text-slate-600">
            {printing.edition} {printing.collector_number ? `#${printing.collector_number}` : ""}
          </span>
        )}
      </div>
    );
  }

  // While a parent is still resolving the CDN url, hold the skeleton rather than
  // hit api.scryfall.com (which the batch fetch exists to avoid).
  const waiting = pending && !imageUrl && face === "front";
  const src = waiting ? undefined : sources[srcIndex];

  return (
    <div className={"relative overflow-hidden rounded-xl " + className}>
      {(!loaded || waiting) && <div className="absolute inset-0 animate-pulse bg-slate-800" />}
      <div className={foil ? "foil-shimmer h-full w-full" : "h-full w-full"}>
        {src && (
          <img
            src={src}
            alt={name}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={handleError}
            className={
              "h-full w-full object-contain transition-opacity duration-200 " +
              (loaded ? "opacity-100" : "opacity-0")
            }
          />
        )}
      </div>
      {dfc && (
        <button
          onClick={(e) => { e.stopPropagation(); flip(); }}
          className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white backdrop-blur transition hover:bg-black/90"
          title={face === "front" ? "Show back face" : "Show front face"}
        >
          {face === "front" ? "Flip" : "Front"}
        </button>
      )}
    </div>
  );
}
