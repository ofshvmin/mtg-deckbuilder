import { useEffect, useRef, useState } from "react";
import type { Printing } from "@mtg/shared";
import {
  scryfallImageUrl,
  scryfallNamedImageUrl,
  isDfc,
  type CardFace,
} from "../lib/scryfall";

// A card image that resolves the exact owned printing, with a graceful chain:
// per-printing (set/collector) -> name lookup -> text placeholder. Shows a
// subtle skeleton while loading. Foil printings get a shimmer overlay; DFCs
// get a flip button to toggle front/back.
export default function CardImage({
  printing,
  name,
  typeLine,
  manaCost,
  className = "",
  isFoil = false,
}: {
  printing?: Printing;
  name: string;
  typeLine?: string;
  manaCost?: string;
  className?: string;
  isFoil?: boolean;
}) {
  const foil = isFoil || printing?.finish === "foil";
  const dfc = isDfc(typeLine, manaCost);
  const printingKey = printing?.printing_key ?? "named";

  const [face, setFace] = useState<CardFace>("front");
  const [src, setSrc] = useState(() => scryfallImageUrl(printing, name, "normal", "front"));
  const [triedFallback, setTriedFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Reset face to front when the printing changes.
  const prevPrintingKey = useRef(printingKey);
  if (prevPrintingKey.current !== printingKey) {
    prevPrintingKey.current = printingKey;
    if (face !== "front") setFace("front");
  }

  // Single effect: update image whenever printing or face changes.
  useEffect(() => {
    const currentFace = face;
    setSrc(scryfallImageUrl(printing, name, "normal", currentFace));
    setTriedFallback(false);
    setFailed(false);
    setLoaded(false);
  }, [printingKey, name, face]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleError() {
    if (face === "back") {
      setFailed(true);
      return;
    }
    const named = scryfallNamedImageUrl(name);
    if (!triedFallback) {
      // If the initial URL was already the named URL (no printing data),
      // retry it once with a cache-bust param in case of a transient error.
      if (src === named) {
        setSrc(named + (named.includes("?") ? "&" : "?") + "_r=1");
      } else {
        setSrc(named);
      }
      setTriedFallback(true);
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

  return (
    <div className={"relative overflow-hidden rounded-xl " + className}>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-slate-800" />}
      <div className={foil ? "foil-shimmer h-full w-full" : "h-full w-full"}>
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
