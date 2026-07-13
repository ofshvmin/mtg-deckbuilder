// Build a "scavenger list": a print-ready PDF pull-guide + checklist for a deck,
// matched to how the collection is stored (by set, then color). Two lists —
// Rares & Mythics, then Commons & Uncommons — each grouped by set (newest first)
// → color (lands their own group) → alphabetical, plus a "multiples" checklist
// for cards owned across 2+ sets. Client-side: rarity/colors are per-printing
// (Scryfall), set names + release dates come from the /sets index.
import type { GeneratedDeck } from "@mtg/shared";
import { loadSetIndex, type SetIndex } from "./scryfallSets";

const COLOR_ORDER = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless", "Lands", "—"];
const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const RARITY_TAG: Record<string, string> = { mythic: "M", rare: "R", uncommon: "U", common: "C", special: "S", bonus: "S" };

const RARES = "Rares & Mythics";
const COMMONS = "Commons & Uncommons";
const OTHER = "Other (printing not resolved)";

function colorGroup(colors: string[], typeLine: string): string {
  if (/\bland\b/i.test(typeLine)) return "Lands";
  if (colors.length === 0) return "Colorless";
  if (colors.length > 1) return "Multicolor";
  return COLOR_NAME[colors[0]] ?? "Colorless";
}

function rarityTier(rarity: string): string {
  if (rarity === "common" || rarity === "uncommon") return COMMONS;
  if (!rarity) return OTHER;
  return RARES; // rare, mythic, special, bonus
}

// ---- Data model ----
export interface ScavCard { name: string; collector: string; tag: string }
export interface ScavColorGroup { color: string; cards: ScavCard[] }
export interface ScavSet { code: string; name: string; released: string; colors: ScavColorGroup[] }
export interface ScavTier { title: string; sets: ScavSet[] }
export interface ScavMultiple { name: string; sets: { code: string; name: string; released: string }[] }
export interface ScavData {
  deckName: string;
  commander: string;
  total: number;
  tiers: ScavTier[];
  multiples: ScavMultiple[];
}

interface CardData { rarity: string; colors: string[]; typeLine: string }

async function fetchCardData(ids: { set: string; collector_number: string }[]): Promise<Map<string, CardData>> {
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

function setName(sets: SetIndex, code: string): string {
  const info = sets.get(code);
  return info ? info.name : code.toUpperCase();
}
function setReleased(sets: SetIndex, code: string): string {
  return sets.get(code)?.released ?? "0000-00-00";
}

export async function buildScavengerData(deck: GeneratedDeck, deckName: string): Promise<ScavData> {
  const ids: { set: string; collector_number: string }[] = [];
  const entries: { name: string; set: string; collector: string }[] = [];
  const cardSets = new Map<string, Set<string>>(); // card name -> distinct set codes owned

  for (const card of deck.cards) {
    if (card.oracle_id.startsWith("basic:")) continue;
    for (const p of card.printings ?? []) {
      if (!p.edition) continue;
      const set = p.edition.toLowerCase();
      const collector = p.collector_number ?? "";
      entries.push({ name: card.name, set, collector });
      if (collector) ids.push({ set, collector_number: collector });
      (cardSets.get(card.name) ?? cardSets.set(card.name, new Set()).get(card.name)!).add(set);
    }
  }

  const [data, sets] = await Promise.all([fetchCardData(ids), loadSetIndex()]);

  // tier -> set code -> color -> cards[]
  const grouped: Record<string, Record<string, Record<string, ScavCard[]>>> = {};
  for (const e of entries) {
    const d = data.get(`${e.set}:${e.collector}`);
    const tier = d ? rarityTier(d.rarity) : OTHER;
    const color = d ? colorGroup(d.colors, d.typeLine) : "—";
    const tag = d ? RARITY_TAG[d.rarity] ?? "" : "";
    (((grouped[tier] ??= {})[e.set] ??= {})[color] ??= []).push({ name: e.name, collector: e.collector, tag });
  }

  const tiers: ScavTier[] = [];
  for (const title of [RARES, COMMONS, OTHER]) {
    const bySet = grouped[title];
    if (!bySet) continue;
    const setCodes = Object.keys(bySet).sort((a, b) => {
      const r = setReleased(sets, b).localeCompare(setReleased(sets, a)); // newest first
      return r !== 0 ? r : setName(sets, a).localeCompare(setName(sets, b));
    });
    const scavSets: ScavSet[] = setCodes.map((code) => {
      const byColor = bySet[code];
      const colorsPresent = COLOR_ORDER.filter((c) => byColor[c]).concat(
        Object.keys(byColor).filter((c) => !COLOR_ORDER.includes(c)),
      );
      return {
        code,
        name: setName(sets, code),
        released: setReleased(sets, code),
        colors: colorsPresent.map((color) => ({
          color,
          cards: byColor[color].slice().sort((a, b) => a.name.localeCompare(b.name)),
        })),
      };
    });
    tiers.push({ title, sets: scavSets });
  }

  const multiples: ScavMultiple[] = [...cardSets.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([name, s]) => ({
      name,
      sets: [...s]
        .map((code) => ({ code, name: setName(sets, code), released: setReleased(sets, code) }))
        .sort((a, b) => b.released.localeCompare(a.released)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { deckName, commander: deck.commander.name, total: deck.total, tiers, multiples };
}

// ---- PDF rendering (jsPDF, dynamically imported so it code-splits out) ----
export async function downloadScavengerPdf(data: ScavData): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const M = 48;              // margin
  const PAGE_H = 792;
  const BOTTOM = PAGE_H - M;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = M;
    }
  };
  const text = (s: string, x: number, size: number, bold: boolean, gray = 40) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(gray);
    doc.text(s, x, y);
  };

  // Header
  text(`Scavenger List — ${data.deckName}`, M, 18, true, 20);
  y += 20;
  text(
    `${data.commander} · ${data.total} cards · ${new Date().toLocaleDateString()} · basic lands excluded`,
    M, 10, false, 120,
  );
  y += 22;

  for (const tier of data.tiers) {
    ensure(40);
    text(tier.title.toUpperCase(), M, 14, true, 20);
    y += 6;
    doc.setDrawColor(200);
    doc.setLineWidth(0.8);
    doc.line(M, y, 612 - M, y);
    y += 16;

    for (const set of tier.sets) {
      ensure(26);
      text(`${set.name} (${set.code.toUpperCase()})`, M, 11, true, 30);
      y += 16;

      for (const cg of set.colors) {
        ensure(24);
        text(cg.color, M + 14, 9.5, true, 90);
        y += 14;
        for (const c of cg.cards) {
          ensure(14);
          doc.setDrawColor(130);
          doc.setLineWidth(0.7);
          doc.rect(M + 28, y - 8, 9, 9);
          text(c.name, M + 44, 10, false, 40);
          const meta = [c.tag, c.collector ? `#${c.collector}` : ""].filter(Boolean).join("  ");
          if (meta) text(meta, 612 - M - 60, 8.5, false, 150);
          y += 14;
        }
        y += 4;
      }
      y += 6;
    }
    y += 8;
  }

  if (data.multiples.length > 0) {
    ensure(40);
    text(`MULTIPLES — owned in 2+ sets (${data.multiples.length})`, M, 14, true, 20);
    y += 6;
    doc.setDrawColor(200);
    doc.line(M, y, 612 - M, y);
    y += 16;
    for (const m of data.multiples) {
      ensure(26);
      doc.setDrawColor(130);
      doc.setLineWidth(0.7);
      doc.rect(M, y - 8, 9, 9);
      text(m.name, M + 16, 10, true, 30);
      y += 13;
      const setsLine = m.sets.map((s) => `${s.name} (${s.code.toUpperCase()})`).join(", ");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120);
      for (const line of doc.splitTextToSize(setsLine, 612 - 2 * M - 24) as string[]) {
        ensure(12);
        doc.text(line, M + 20, y);
        y += 12;
      }
      y += 4;
    }
  }

  const safe = data.deckName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
  doc.save(`${safe}-scavenger-list.pdf`);
}
