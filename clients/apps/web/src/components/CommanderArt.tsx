import { useCallback, useState, type ReactNode } from "react";

// Stylized commander banner using Scryfall's `art_crop` (just the artwork, no
// frame) — used as the hero on the deck detail page and the header on saved-deck
// tiles. Falls back to a gradient if the art can't be fetched. Children render
// on top (name overlays, gradients, etc.).
//
// Scryfall's image policy only permits an art_crop where the illustrator is
// credited in the same interface, so the art and the credit arrive together
// from the API (see card_prints.art_by_name) and are rendered as a pair. When
// the backend has no credited art for a commander we show the gradient rather
// than an uncredited crop — that also keeps us off the rate-limited
// api.scryfall.com image endpoint.
export default function CommanderArt({
  name,
  className = "",
  children,
  position = "top",
  artCropUrl,
  artist,
}: {
  name: string;
  className?: string;
  children?: ReactNode;
  // Card art usually has the character up top, so bias the crop there by default.
  position?: "top" | "center";
  artCropUrl?: string | null;
  artist?: string | null;
}) {
  // Load state is keyed by the URL it belongs to rather than reset in an effect:
  // a cached image can fire `load` before an effect runs, and resetting after
  // that left the art downloaded but stuck invisible (and uncredited).
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // One retry with a cache-busting param before falling back to the gradient,
  // so a single slow or dropped request from Scryfall's CDN doesn't blank a tile.
  const [retried, setRetried] = useState<string | null>(null);

  const src = artCropUrl
    ? retried === artCropUrl
      ? `${artCropUrl}${artCropUrl.includes("?") ? "&" : "?"}retry=1`
      : artCropUrl
    : null;
  const loaded = src !== null && loadedSrc === src;
  const showArt = src !== null && failedSrc !== artCropUrl;

  // A cached image can finish loading before React attaches `onLoad`, so that
  // event never fires. Catch it on attach (same fix as CardImage).
  const attachImg = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setLoadedSrc(node.getAttribute("src"));
  }, []);

  function handleError() {
    if (!artCropUrl) return;
    if (retried !== artCropUrl) setRetried(artCropUrl);
    else setFailedSrc(artCropUrl);
  }

  return (
    <div className={"relative overflow-hidden bg-slate-800 " + className}>
      {/* Gradient placeholder (also the skeleton while loading). */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950" />
      {showArt && (
        <img
          key={src}
          ref={attachImg}
          src={src as string}
          alt={name}
          loading="lazy"
          onLoad={(e) => setLoadedSrc(e.currentTarget.getAttribute("src"))}
          onError={handleError}
          className={
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500 " +
            (position === "top" ? "object-top " : "object-center ") +
            (loaded ? "opacity-100" : "opacity-0")
          }
        />
      )}
      {children}
      {showArt && loaded && artist && (
        <span
          className="pointer-events-none absolute bottom-0 right-0 z-10 max-w-[60%] truncate pb-0.5 pr-1.5 text-[9px] leading-none text-white/70 drop-shadow"
          title={`Illustrated by ${artist}`}
        >
          {artist}
        </span>
      )}
    </div>
  );
}
