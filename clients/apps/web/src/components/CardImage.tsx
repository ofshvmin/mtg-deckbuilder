import { useCallback, useMemo, useState } from "react";
import type { Printing } from "@mtg/shared";
import {
  scryfallImageUrl,
  scryfallNamedImageUrl,
  isDfc,
  type CardFace,
} from "../lib/scryfall";

// A card image with a graceful source chain. Real cards.scryfall.io CDN urls
// come from the backend as `printing.image_uris`, or from a parent that
// batch-fetched them (`imageUrl`); those are preferred because the CDN isn't
// rate-limited, unlike the api.scryfall.com image endpoint, so bulk grids no
// longer drop later cards once Scryfall throttles a burst of ~99 requests. It
// falls back to the per-printing and named API endpoints, then a text
// placeholder. `pending` holds the skeleton while a parent is still
// batch-fetching, so we don't fire the request that the batch exists to avoid.
export default function CardImage({
  printing,
  name,
  typeLine,
  manaCost,
  className = "",
  isFoil = false,
  imageUrl,
  pending = false,
  eager = false,
}: {
  printing?: Printing;
  name: string;
  typeLine?: string;
  manaCost?: string;
  className?: string;
  isFoil?: boolean;
  imageUrl?: string;
  pending?: boolean;
  /** Set on images that are already on screen when they mount (see `loading`). */
  eager?: boolean;
}) {
  const foil = isFoil || printing?.finish === "foil";
  const dfc = isDfc(typeLine, manaCost);
  const printingKey = printing?.printing_key ?? "named";

  const [face, setFace] = useState<CardFace>("front");
  const [srcIndex, setSrcIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  // Which url finished loading — *not* a boolean. A boolean has to be cleared
  // whenever the card changes, and that clear races the `load` event: if the
  // url we settle on is one that already loaded, no second `load` is ever
  // coming, so the flag stays false and the art sits at opacity-0 under the
  // skeleton forever. Comparing a url against the current src has no such race.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  // Ordered fallback sources:
  //   DB CDN url (per-printing) → parent CDN url → constructed CDN url → API → named API.
  const sources = useMemo(() => {
    const dbUrl = face === "back"
      ? printing?.image_uris_back?.normal
      : printing?.image_uris?.normal;
    if (face === "back") {
      const list: string[] = [];
      if (dbUrl) list.push(dbUrl);
      list.push(scryfallImageUrl(printing, name, "normal", "back"));
      list.push(scryfallNamedImageUrl(name, "normal", "back"));
      return [...new Set(list)];
    }
    const list: string[] = [];
    if (dbUrl) list.push(dbUrl);
    if (imageUrl) list.push(imageUrl);
    list.push(scryfallImageUrl(printing, name, "normal", "front"));
    list.push(scryfallNamedImageUrl(name, "normal", "front"));
    return [...new Set(list)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, printingKey, name, face]);

  // Restart the fallback chain when the candidate list itself changes. Adjusted
  // during render rather than in an effect so it lands before the browser can
  // fire `load` on the new <img>. Deliberately doesn't clear the loaded url:
  // the chain gets rebuilt whenever a printing resolves, while `sources[0]`
  // usually stays the very same url that's already on screen.
  const chainKey = sources.join(" ");
  const [prevChainKey, setPrevChainKey] = useState(chainKey);
  if (prevChainKey !== chainKey) {
    setPrevChainKey(chainKey);
    setSrcIndex(0);
    setFailed(false);
  }

  // Reset to the front face when the printing changes.
  const [prevPrintingKey, setPrevPrintingKey] = useState(printingKey);
  if (prevPrintingKey !== printingKey) {
    setPrevPrintingKey(printingKey);
    if (face !== "front") setFace("front");
  }

  // A cached image can finish loading before React attaches `onLoad`, so that
  // event never fires and the skeleton would never lift. Catch it on attach.
  const attachImg = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setLoadedSrc(node.src);
  }, []);

  function handleError() {
    if (srcIndex < sources.length - 1) setSrcIndex((i) => i + 1);
    else setFailed(true);
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
  const loaded = src != null && loadedSrc === src;

  return (
    <div className={"relative overflow-hidden rounded-xl " + className}>
      {(!loaded || waiting) && <div className="absolute inset-0 animate-pulse bg-slate-800" />}
      <div className={foil ? "foil-shimmer h-full w-full" : "h-full w-full"}>
        {src && (
          <img
            // Remount per url so `attachImg` gets to check an already-complete
            // image, and so a retried url actually re-requests.
            key={src}
            ref={attachImg}
            src={src}
            alt={name}
            // `lazy` pays off in the big grids, but an image that's already on
            // screen when it mounts has nothing to defer for, and leaving that
            // to the browser's lazy heuristic only risks it not loading.
            loading={eager ? "eager" : "lazy"}
            onLoad={() => setLoadedSrc(src)}
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
