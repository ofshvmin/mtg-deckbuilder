// Fetch every printing of a card (by oracle_id) from Scryfall, so the user can
// pick the exact set/collector when adding a card. Client-side, matching the
// images/sets approach. Memoized per oracle_id.

export interface PrintOption {
  set: string;              // set code, e.g. "c21"
  setName: string;
  collectorNumber: string;
  releasedAt: string;       // ISO date
  finishes: string[];       // e.g. ["nonfoil", "foil"]
  imageUri?: string;
  priceUsd?: number | null;
  priceUsdFoil?: number | null;
}

interface ScryfallCard {
  set: string;
  set_name: string;
  collector_number: string;
  released_at: string;
  finishes?: string[];
  image_uris?: { normal?: string; small?: string };
  card_faces?: Array<{ image_uris?: { normal?: string; small?: string } }>;
  prices?: { usd?: string | null; usd_foil?: string | null };
}

const cache = new Map<string, Promise<PrintOption[]>>();
const MAX_PAGES = 4;

function toOption(c: ScryfallCard): PrintOption {
  const img = c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal;
  return {
    set: c.set,
    setName: c.set_name,
    collectorNumber: c.collector_number,
    releasedAt: c.released_at,
    finishes: c.finishes ?? ["nonfoil"],
    imageUri: img,
    priceUsd: c.prices?.usd != null ? Number(c.prices.usd) : null,
    priceUsdFoil: c.prices?.usd_foil != null ? Number(c.prices.usd_foil) : null,
  };
}

export function fetchPrintings(oracleId: string): Promise<PrintOption[]> {
  const hit = cache.get(oracleId);
  if (hit) return hit;

  const run = (async () => {
    const out: PrintOption[] = [];
    let url: string | null =
      `https://api.scryfall.com/cards/search?q=oracleid%3A${encodeURIComponent(oracleId)}` +
      `&unique=prints&order=released&dir=desc`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res: Response = await fetch(url);
      if (!res.ok) break; // 404 = no prints; return what we have
      const body: { data?: ScryfallCard[]; has_more?: boolean; next_page?: string } = await res.json();
      for (const c of body.data ?? []) out.push(toOption(c));
      url = body.has_more && body.next_page ? body.next_page : null;
    }
    return out;
  })().catch(() => {
    cache.delete(oracleId); // allow retry
    return [];
  });

  cache.set(oracleId, run);
  return run;
}
