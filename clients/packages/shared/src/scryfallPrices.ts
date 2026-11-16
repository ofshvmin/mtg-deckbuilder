// Batch-fetch card prices (and a thumbnail) from Scryfall by oracle_id, using
// the /cards/collection endpoint (up to 75 identifiers per request). Client-side,
// matching the owned-now/catalog-later model — we don't store prices server-side.
// Results are memoized per oracle_id for the session.

export interface CardPrice {
  usd: number | null;
  imageUri?: string;
}

interface ScryfallCard {
  oracle_id?: string;
  prices?: { usd?: string | null };
  image_uris?: { normal?: string };
  card_faces?: Array<{ image_uris?: { normal?: string } }>;
}

const CHUNK = 75;
const cache = new Map<string, CardPrice>();

function toPrice(c: ScryfallCard): CardPrice {
  return {
    usd: c.prices?.usd != null ? Number(c.prices.usd) : null,
    imageUri: c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal,
  };
}

/** Return a map of oracle_id -> price. Cached ids skip the network. */
export async function fetchPrices(oracleIds: string[]): Promise<Map<string, CardPrice>> {
  const out = new Map<string, CardPrice>();
  const missing: string[] = [];
  for (const id of oracleIds) {
    const hit = cache.get(id);
    if (hit) out.set(id, hit);
    else missing.push(id);
  }

  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk.map((id) => ({ oracle_id: id })) }),
      });
      if (!res.ok) continue;
      const body: { data?: ScryfallCard[] } = await res.json();
      for (const c of body.data ?? []) {
        if (!c.oracle_id) continue;
        const price = toPrice(c);
        cache.set(c.oracle_id, price);
        out.set(c.oracle_id, price);
      }
    } catch {
      // network hiccup — leave these unpriced; caller renders "—"
    }
  }
  return out;
}
