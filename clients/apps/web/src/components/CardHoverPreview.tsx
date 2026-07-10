import { useEffect, useRef, useState } from "react";
import type { Printing } from "@mtg/shared";
import { scryfallImageUrl, scryfallNamedImageUrl } from "../lib/scryfall";

// Floating card image that appears when the user hovers over a card name.
// Positioned to the right of the cursor, flips to the left if near the
// viewport edge. Appears after a short delay to avoid flicker.

const DELAY_MS = 180;
const IMG_W = 250;
const IMG_H = 349; // ~5:7 ratio

export default function CardHoverPreview({
  name,
  printing,
  anchorRect,
}: {
  name: string;
  printing?: Printing;
  anchorRect: DOMRect;
}) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const src = printing?.edition && printing.collector_number
    ? scryfallImageUrl(printing, name, "normal")
    : scryfallNamedImageUrl(name, "normal");

  // Position: prefer right of anchor, flip left if it would overflow viewport.
  const gap = 12;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  let left = anchorRect.right + gap;
  if (left + IMG_W > viewW - 8) {
    left = anchorRect.left - IMG_W - gap;
  }
  left = Math.max(8, left);

  let top = anchorRect.top + (anchorRect.height / 2) - (IMG_H / 2);
  top = Math.max(8, Math.min(top, viewH - IMG_H - 8));

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-[100] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      style={{ left, top, width: IMG_W, height: IMG_H }}
    >
      {!loaded && <div className="absolute inset-0 animate-pulse bg-slate-800" />}
      {printing?.finish === "foil" && (
        <div className="foil-shimmer absolute inset-0 z-10" />
      )}
      <img
        src={src}
        alt={name}
        onLoad={() => setLoaded(true)}
        onError={() => {}}
        className={
          "h-full w-full object-contain transition-opacity duration-150 " +
          (loaded ? "opacity-100" : "opacity-0")
        }
      />
    </div>
  );
}

// Hook: manages the hover state + delay for showing the preview.
export function useCardHover() {
  const [hover, setHover] = useState<{
    name: string;
    printing?: Printing;
    rect: DOMRect;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onEnter(
    e: React.MouseEvent,
    name: string,
    printing?: Printing,
  ) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    timerRef.current = setTimeout(() => {
      setHover({ name, printing, rect });
    }, DELAY_MS);
  }

  function onLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setHover(null);
  }

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { hover, onEnter, onLeave };
}
