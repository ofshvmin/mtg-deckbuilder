import { useEffect, useState } from "react";
import { File, Paths } from "expo-file-system";
import type { SetIndex, SetInfo } from "@mtg/shared";

// Set names and logos, from Scryfall's /sets — the web app's catalog, with its
// localStorage cache swapped for a file in the app's cache directory. Our DB
// stores only set codes, so this is where a set symbol comes from.

export type { SetIndex, SetInfo };

const TTL_MS = 24 * 60 * 60 * 1000;

let inflight: Promise<SetIndex> | null = null;

// v2: entries carry parentCode, which the pull list groups sets by.
function cacheFile(): File {
  return new File(Paths.cache, "scryfall-sets.v2.json");
}

async function fromCache(): Promise<SetIndex | null> {
  try {
    const file = cacheFile();
    if (!file.exists) return null;
    const { ts, sets } = JSON.parse(await file.text()) as { ts: number; sets: [string, SetInfo][] };
    if (Date.now() - ts > TTL_MS) return null;
    return new Map(sets);
  } catch {
    return null;
  }
}

function toCache(index: SetIndex) {
  try {
    cacheFile().write(JSON.stringify({ ts: Date.now(), sets: [...index.entries()] }));
  } catch {
    // A missing cache only costs a refetch next launch.
  }
}

async function fetchIndex(): Promise<SetIndex> {
  const res = await fetch("https://api.scryfall.com/sets");
  if (!res.ok) throw new Error("sets fetch failed");
  const body = (await res.json()) as {
    data?: {
      code: string;
      name: string;
      icon_svg_uri: string;
      released_at?: string;
      parent_set_code?: string;
    }[];
  };
  const index: SetIndex = new Map();
  for (const s of body.data ?? []) {
    index.set(s.code.toLowerCase(), {
      name: s.name,
      iconSvgUri: s.icon_svg_uri,
      released: s.released_at,
      parentCode: s.parent_set_code?.toLowerCase(),
    });
  }
  toCache(index);
  return index;
}

/** The code → {name, icon} index, loaded once per launch from cache or Scryfall. */
export function loadSetIndex(): Promise<SetIndex> {
  if (inflight) return inflight;
  inflight = (async () => (await fromCache()) ?? (await fetchIndex()))().catch(() => {
    inflight = null; // allow a later retry
    return new Map<string, SetInfo>();
  });
  return inflight;
}

/** The set index, or null while it loads. */
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

export function lookupSet(index: SetIndex | null, code?: string | null): SetInfo | undefined {
  if (!index || !code) return undefined;
  return index.get(code.toLowerCase());
}
