import { useEffect, useState } from "react";

// Set names + logos aren't in our DB (we store only set codes). Scryfall's
// /sets endpoint is the authoritative source for both, so we fetch it once per
// session (memoized) and cache in localStorage (24h) to avoid refetching across
// reloads. Matches the "owned-now, catalog-later" approach used for card images.

export interface SetInfo {
  name: string;
  iconSvgUri: string;
  released?: string; // ISO date, for ordering sets newest-first
}

export type SetIndex = Map<string, SetInfo>;

const CACHE_KEY = "mtg.sets.v2";
const TTL_MS = 24 * 60 * 60 * 1000;

let inflight: Promise<SetIndex> | null = null;

function fromCache(): SetIndex | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, sets } = JSON.parse(raw) as { ts: number; sets: [string, SetInfo][] };
    if (Date.now() - ts > TTL_MS) return null;
    return new Map(sets);
  } catch {
    return null;
  }
}

function toCache(index: SetIndex) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), sets: [...index.entries()] }));
  } catch {
    // ignore quota / serialization errors
  }
}

/** Load the code → {name, iconSvgUri} index once, from cache or Scryfall. */
export function loadSetIndex(): Promise<SetIndex> {
  if (inflight) return inflight;
  const cached = fromCache();
  if (cached) {
    inflight = Promise.resolve(cached);
    return inflight;
  }
  inflight = fetch("https://api.scryfall.com/sets")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sets fetch failed"))))
    .then((body: { data?: Array<{ code: string; name: string; icon_svg_uri: string; released_at?: string }> }) => {
      const index: SetIndex = new Map();
      for (const s of body.data ?? []) {
        index.set(s.code.toLowerCase(), { name: s.name, iconSvgUri: s.icon_svg_uri, released: s.released_at });
      }
      toCache(index);
      return index;
    })
    .catch(() => {
      inflight = null; // allow a later retry
      return new Map<string, SetInfo>();
    });
  return inflight;
}

/** React hook: the set index (or null while loading). */
export function useScryfallSets(): SetIndex | null {
  const [index, setIndex] = useState<SetIndex | null>(null);
  useEffect(() => {
    let alive = true;
    loadSetIndex().then((i) => {
      if (alive) setIndex(i);
    });
    return () => {
      alive = false;
    };
  }, []);
  return index;
}

/** Look up a set by code, tolerant of case/undefined. */
export function lookupSet(index: SetIndex | null, code?: string | null): SetInfo | undefined {
  if (!index || !code) return undefined;
  return index.get(code.toLowerCase());
}
