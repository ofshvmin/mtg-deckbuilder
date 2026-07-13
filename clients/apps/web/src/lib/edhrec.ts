/** Client-side EDHREC helpers.
 *
 * json.edhrec.com has CORS (Access-Control-Allow-Origin: *) so the browser
 * can fetch deck hash lists directly. Preview/detail calls go through our backend.
 */

export interface EdhrecDeckEntry {
  urlhash: string;
  price?: number;
  salt?: number;
  bracket?: number | null;
}

/** Convert a commander name to an EDHREC URL slug. */
export function commanderToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[',.\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Fetch deck hash list from EDHREC (client-side, has CORS). Returns top N hashes. */
export async function fetchDeckHashes(commander: string, limit = 20): Promise<EdhrecDeckEntry[]> {
  const slug = commanderToSlug(commander);
  const resp = await fetch(`https://json.edhrec.com/pages/decks/${slug}.json`);
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`EDHREC search failed (${resp.status})`);
  const data = await resp.json();
  const table: EdhrecDeckEntry[] = (data.table ?? []).slice(0, limit);
  return table;
}
