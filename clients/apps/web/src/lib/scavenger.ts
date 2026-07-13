// Build a "scavenger list": a physical pull-guide + checklist for a deck, matched
// to how the collection is stored (by set, then color). Rares and commons/uncommons
// are separate lists, each grouped by set → color (lands their own group),
// alphabetical, plus a "multiples" checklist for cards owned across 2+ sets.
// Client-side because rarity/colors are per-printing (fetched from Scryfall).
import type { GeneratedDeck } from "@mtg/shared";

interface CardData {
  set: string;
  setName: string;
  collector: string;
  rarity: string;
  colors: string[];
  typeLine: string;
}

const COLOR_ORDER = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless", "Lands"];
const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

function colorGroup(colors: string[], typeLine: string): string {
  if (/\bland\b/i.test(typeLine)) return "Lands";
  if (colors.length === 0) return "Colorless";
  if (colors.length > 1) return "Multicolor";
  return COLOR_NAME[colors[0]] ?? "Colorless";
}

function isRare(rarity: string): boolean {
  return rarity !== "common" && rarity !== "uncommon"; // rare, mythic, special, bonus
}

async function fetchCardData(
  ids: { set: string; collector_number: string }[],
): Promise<Map<string, CardData>> {
  const out = new Map<string, CardData>();
  for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75);
    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: chunk }),
      });
      if (!res.ok) continue;
      const body = await res.json();
      for (const c of body.data ?? []) {
        out.set(`${c.set}:${c.collector_number}`, {
          set: c.set,
          setName: c.set_name ?? c.set?.toUpperCase() ?? "Unknown set",
          collector: c.collector_number ?? "",
          rarity: c.rarity ?? "",
          colors: c.colors ?? c.card_faces?.[0]?.colors ?? [],
          typeLine: c.type_line ?? "",
        });
      }
    } catch {
      /* skip chunk */
    }
  }
  return out;
}

type Groups = Record<string, Record<string, Record<string, string[]>>>; // tier -> setName -> color -> names

function addEntry(groups: Groups, tier: string, setName: string, color: string, label: string) {
  ((groups[tier] ??= {})[setName] ??= {})[color] ??= [];
  groups[tier][setName][color].push(label);
}

export async function buildScavengerList(deck: GeneratedDeck, deckName: string): Promise<string> {
  const ids: { set: string; collector_number: string }[] = [];
  const printingEntries: { name: string; set: string; collector: string }[] = [];
  const cardSets = new Map<string, Set<string>>(); // card name -> distinct set codes owned

  for (const card of deck.cards) {
    if (card.oracle_id.startsWith("basic:")) continue;
    for (const p of card.printings ?? []) {
      if (!p.edition) continue;
      const set = p.edition.toLowerCase();
      const collector = p.collector_number ?? "";
      printingEntries.push({ name: card.name, set, collector });
      if (collector) ids.push({ set, collector_number: collector });
      (cardSets.get(card.name) ?? cardSets.set(card.name, new Set()).get(card.name)!).add(set);
    }
  }

  const data = await fetchCardData(ids);

  const RARES = "Rares & Mythics";
  const COMMONS = "Commons & Uncommons";
  const OTHER = "Other / unknown printings";
  const groups: Groups = {};

  for (const e of printingEntries) {
    const d = data.get(`${e.set}:${e.collector}`);
    if (!d) {
      addEntry(groups, OTHER, e.set.toUpperCase(), "—", `${e.name}${e.collector ? ` · #${e.collector}` : ""}`);
      continue;
    }
    const tier = isRare(d.rarity) ? RARES : COMMONS;
    const color = colorGroup(d.colors, d.typeLine);
    const setLabel = `${d.setName} (${d.set.toUpperCase()})`;
    addEntry(groups, tier, setLabel, color, `${e.name}${d.collector ? ` · #${d.collector}` : ""}`);
  }

  // ---- Render markdown ----
  const lines: string[] = [];
  const commanderLine = `${deck.commander.name} · ${deck.total} cards`;
  lines.push(`# Scavenger list — ${deckName}`, "", commanderLine, "", `_Generated ${new Date().toLocaleDateString()}. Basic lands excluded._`, "");

  for (const tier of [RARES, COMMONS, OTHER]) {
    const bySet = groups[tier];
    if (!bySet) continue;
    lines.push(`## ${tier}`, "");
    for (const setName of Object.keys(bySet).sort((a, b) => a.localeCompare(b))) {
      lines.push(`### ${setName}`, "");
      const byColor = bySet[setName];
      const colorsPresent = COLOR_ORDER.filter((c) => byColor[c]).concat(
        Object.keys(byColor).filter((c) => !COLOR_ORDER.includes(c)),
      );
      for (const color of colorsPresent) {
        lines.push(`**${color}**`, "");
        for (const label of byColor[color].sort((a, b) => a.localeCompare(b))) {
          lines.push(`- [ ] ${label}`);
        }
        lines.push("");
      }
    }
  }

  const multiples = [...cardSets.entries()]
    .filter(([, sets]) => sets.size > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (multiples.length > 0) {
    lines.push(`## Multiples — owned in 2+ sets (${multiples.length})`, "");
    for (const [name, sets] of multiples) {
      lines.push(`- [ ] ${name} — ${[...sets].map((s) => s.toUpperCase()).sort().join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
