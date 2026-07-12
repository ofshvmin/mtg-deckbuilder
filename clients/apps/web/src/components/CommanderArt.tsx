import { useEffect, useState, type ReactNode } from "react";
import { scryfallNamedImageUrl } from "../lib/scryfall";

// Stylized commander banner using Scryfall's `art_crop` (just the artwork, no
// frame) — used as the hero on the deck detail page and the header on saved-deck
// tiles. Falls back to a gradient if the art can't be fetched. Children render
// on top (name overlays, gradients, etc.).
export default function CommanderArt({
  name,
  className = "",
  children,
  position = "top",
}: {
  name: string;
  className?: string;
  children?: ReactNode;
  // Card art usually has the character up top, so bias the crop there by default.
  position?: "top" | "center";
}) {
  const [src, setSrc] = useState(() => scryfallNamedImageUrl(name, "art_crop"));
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSrc(scryfallNamedImageUrl(name, "art_crop"));
    setFailed(false);
    setLoaded(false);
  }, [name]);

  return (
    <div className={"relative overflow-hidden bg-slate-800 " + className}>
      {/* Gradient placeholder (also the skeleton while loading). */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950" />
      {!failed && (
        <img
          src={src}
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
    </div>
  );
}
