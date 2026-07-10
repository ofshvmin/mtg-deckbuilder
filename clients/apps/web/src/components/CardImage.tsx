import { useEffect, useState } from "react";
import type { Printing } from "@mtg/shared";
import { scryfallImageUrl, scryfallNamedImageUrl } from "../lib/scryfall";

// A card image that resolves the exact owned printing, with a graceful chain:
// per-printing (set/collector) → name lookup → a text placeholder. Shows a
// subtle skeleton while loading.
export default function CardImage({
  printing,
  name,
  className = "",
}: {
  printing?: Printing;
  name: string;
  className?: string;
}) {
  const key = `${printing?.printing_key ?? "named"}|${name}`;
  const [src, setSrc] = useState(() => scryfallImageUrl(printing, name));
  const [triedFallback, setTriedFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Reset when the focused printing (or card) changes.
  useEffect(() => {
    setSrc(scryfallImageUrl(printing, name));
    setTriedFallback(false);
    setFailed(false);
    setLoaded(false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleError() {
    const named = scryfallNamedImageUrl(name);
    if (!triedFallback && src !== named) {
      setSrc(named);
      setTriedFallback(true);
    } else {
      setFailed(true);
    }
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
  );
}
