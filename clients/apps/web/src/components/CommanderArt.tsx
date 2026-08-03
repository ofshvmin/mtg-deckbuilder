import { useEffect, useState, type ReactNode } from "react";

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
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [name, artCropUrl]);

  const showArt = Boolean(artCropUrl) && !failed;

  return (
    <div className={"relative overflow-hidden bg-slate-800 " + className}>
      {/* Gradient placeholder (also the skeleton while loading). */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950" />
      {showArt && (
        <img
          src={artCropUrl as string}
          alt={name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
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
