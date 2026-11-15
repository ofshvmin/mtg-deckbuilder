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
  flavorName?: string;      // reskinned cards (e.g. "Cecil Harvey" for Tymna in FF set)
}

interface ScryfallCard {
  set: string;
  set_name: string;
  collector_number: string;
  released_at: string;
  finishes?: string[];
  image_uris?: { normal?: string; small?: string };
  card_faces?: Array<{ image_uris?: { normal?: string; small?: string }; oracle_text?: string }>;
  prices?: { usd?: string | null; usd_foil?: string | null };
  oracle_text?: string;
  type_line?: string;
  mana_cost?: string;
  flavor_name?: string;
}

export interface CardDetail {
  oracleText?: string;
  typeLine?: string;
  manaCost?: string;
  prints: PrintOption[];
}

const detailCache = new Map<string, Promise<CardDetail>>();

function oracleTextOf(c: ScryfallCard): string | undefined {
  if (c.oracle_text) return c.oracle_text;
  const faces = (c as { card_faces?: Array<{ oracle_text?: string }> }).card_faces;
  if (faces?.length) return faces.map((f) => f.oracle_text).filter(Boolean).join("\n//\n");
  return undefined;
}

/** Newest printing that isn't a reskin (no flavor_name). Falls back to newest overall. */
export function originalPrint(prints: PrintOption[]): PrintOption | undefined {
  return prints.find((p) => !p.flavorName) ?? prints[0];
}

/** Cheapest printing (by USD non-foil); falls back to the first if none priced. */
export function cheapestPrint(prints: PrintOption[]): PrintOption | undefined {
  const priced = prints.filter((p) => p.priceUsd != null);
  if (priced.length === 0) return prints[0];
  return priced.reduce((a, b) => ((a.priceUsd ?? Infinity) <= (b.priceUsd ?? Infinity) ? a : b));
}

/** Fetch a card's oracle text + every printing with prices, by oracle_id or exact name. */
export function fetchCardDetail(opts: { oracleId?: string; name: string }): Promise<CardDetail> {
  const key = opts.oracleId ? `id:${opts.oracleId}` : `name:${opts.name.toLowerCase()}`;
  const hit = detailCache.get(key);
  if (hit) return hit;

  const q = opts.oracleId
    ? `oracleid:${opts.oracleId}`
    : `!"${opts.name.replace(/"/g, "")}"`;

  const run = (async (): Promise<CardDetail> => {
    const out: PrintOption[] = [];
    let oracleText: string | undefined;
    let typeLine: string | undefined;
    let manaCost: string | undefined;
    let url: string | null =
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}` +
      `&unique=prints&order=released&dir=desc`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res: Response = await fetch(url);
      if (!res.ok) break;
      const body: { data?: ScryfallCard[]; has_more?: boolean; next_page?: string } = await res.json();
      for (const c of body.data ?? []) {
        if (oracleText === undefined) { oracleText = oracleTextOf(c); typeLine = c.type_line; manaCost = c.mana_cost; }
        out.push(toOption(c));
      }
      url = body.has_more && body.next_page ? body.next_page : null;
    }
    return { oracleText, typeLine, manaCost, prints: out };
  })().catch(() => {
    detailCache.delete(key);
    return { prints: [] };
  });

  detailCache.set(key, run);
  return run;
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
    flavorName: c.flavor_name,
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
