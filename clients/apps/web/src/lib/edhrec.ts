/** Client-side EDHREC API helpers.
 *
 * EDHREC blocks server-side calls (cloud IPs) but allows browser requests.
 * So search + preview happen client-side; only card resolution goes to our backend.
 */

export interface EdhrecDeckEntry {
  urlhash: string;
  price?: number;
  salt?: number;
  bracket?: number | null;
}

export interface EdhrecPreview {
  deck: string[];          // ["1 Sol Ring", "1 Command Tower", ...]
  commanders: string[];
  coloridentity: string[];
  url: string;             // source URL (archidekt/moxfield)
  header?: string;
  price?: number;
  salt?: number;
}

/** Convert a commander name to an EDHREC URL slug. */
export function commanderToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[',.\u2019]/g, "")    // remove apostrophes, commas, periods
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const COLOR_MAP: Record<string, string> = {
  W: "W", U: "U", B: "B", R: "R", G: "G",
  White: "W", Blue: "U", Black: "B", Red: "R", Green: "G",
};

function normalizeColors(colors: string[]): string[] {
  const out: string[] = [];
  for (const c of colors) {
    const mapped = COLOR_MAP[c] ?? (c.length === 1 ? c.toUpperCase() : "");
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/** Search EDHREC for decklists by commander name. Returns top N deck summaries. */
export async function searchDecks(commander: string, pageSize = 20) {
  const slug = commanderToSlug(commander);
  const resp = await fetch(`https://json.edhrec.com/pages/decks/${slug}.json`);
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`EDHREC search failed (${resp.status})`);
  const data = await resp.json();

  const table: EdhrecDeckEntry[] = (data.table ?? []).slice(0, pageSize);
  if (table.length === 0) return [];

  // Batch-fetch previews for each hash
  const results: {
    external_id: string;
    source: string;
    name: string;
    owner: string;
    card_count: number;
    url: string;
    commander_name: string;
    color_identity: string[];
    bracket: number | null;
    price: number | null;
  }[] = [];

  // Fetch previews in parallel (limited concurrency)
  const previews = await Promise.allSettled(
    table.map((entry) =>
      fetch(`https://edhrec.com/api/deckpreview/${entry.urlhash}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );

  for (let i = 0; i < table.length; i++) {
    const entry = table[i];
    const result = previews[i];
    const preview: EdhrecPreview | null =
      result.status === "fulfilled" ? result.value : null;
    if (!preview) continue;

    const deckLines = preview.deck ?? [];
    const commanders = preview.commanders ?? [];
    const cmdName = commanders[0] ?? commander;
    const colors = normalizeColors(preview.coloridentity ?? []);
    const sourceUrl = preview.url ?? "";

    let source = "edhrec";
    if (sourceUrl.includes("archidekt.com")) source = "archidekt";
    else if (sourceUrl.includes("moxfield.com")) source = "moxfield";

    results.push({
      external_id: entry.urlhash,
      source,
      name: preview.header ?? `${cmdName} Deck`,
      owner: source === "edhrec" ? "EDHREC" : source,
      card_count: deckLines.length,
      url: sourceUrl || `https://edhrec.com/deckpreview/${entry.urlhash}`,
      commander_name: cmdName,
      color_identity: colors,
      bracket: entry.bracket ?? null,
      price: entry.price ?? preview.price ?? null,
    });
  }

  return results;
}

/** Fetch a single deck preview from EDHREC by hash. */
export async function fetchPreview(hash: string): Promise<EdhrecPreview | null> {
  const resp = await fetch(`https://edhrec.com/api/deckpreview/${hash}`);
  if (!resp.ok) return null;
  return resp.json();
}
