// The collection browser's filters and sorts, shared by web and mobile — so a
// change here moves both apps at once. These pin the behaviour that's easy to
// get subtly wrong: the three color modes, colorless, and data that older
// backends don't send.
import { describe, expect, it } from "vitest";
import type { CollectionCard, Color, Printing } from "./types";
import {
  EMPTY_FILTERS,
  cardTypes,
  filterCards,
  fromSearchParams,
  isFiltered,
  sortCards,
  toSearchParams,
  type FilterState,
} from "./collectionFilter";

function printing(edition: string, extra: Partial<Printing> = {}): Printing {
  return {
    printing_key: `${edition}-1-nonfoil`,
    edition,
    collector_number: "1",
    finish: "nonfoil",
    condition: null,
    language: null,
    count: 1,
    ...extra,
  };
}

function card(name: string, identity: Color[], extra: Partial<CollectionCard> = {}): CollectionCard {
  return {
    oracle_id: name.toLowerCase(),
    name,
    mana_cost: "",
    cmc: 3,
    type_line: "Creature — Elf",
    color_identity: identity,
    colors: identity,
    oracle_text: "",
    total_count: 1,
    printings: [printing("m21")],
    ...extra,
  };
}

const ELF = card("Llanowar Elves", ["G"], { cmc: 1, rarity: "common" });
const TROSTANI = card("Trostani", ["G", "W"], {
  type_line: "Legendary Creature — Dryad",
  rarity: "mythic",
  printings: [printing("GPT", { price_usd: 5 })],
});
const ATRAXA = card("Atraxa", ["W", "U", "B", "G"], { cmc: 4, rarity: "mythic", reserved: false });
const SOL_RING = card("Sol Ring", [], {
  cmc: 1,
  type_line: "Artifact",
  rarity: "uncommon",
  game_changer: true,
  total_count: 4,
  printings: [printing("c21", { count: 4, finish: "foil", price_usd_foil: 2 })],
});
const ALL = [ELF, TROSTANI, ATRAXA, SOL_RING];

const names = (f: Partial<FilterState>) =>
  filterCards(ALL, { ...EMPTY_FILTERS, ...f }).map((c) => c.name).sort();

describe("color modes", () => {
  it("any of: includes at least one selected color", () => {
    expect(names({ colors: ["W"] })).toEqual(["Atraxa", "Trostani"]);
  });

  it("exactly: the identity is the selection, no more", () => {
    expect(names({ colors: ["G", "W"], colorMode: "exact" })).toEqual(["Trostani"]);
  });

  it("at most: fits in a deck of these colors, colorless always fits", () => {
    expect(names({ colors: ["G", "W"], colorMode: "atMost" })).toEqual([
      "Llanowar Elves", "Sol Ring", "Trostani",
    ]);
  });

  it("colorless alone finds colorless cards", () => {
    expect(names({ colorless: true })).toEqual(["Sol Ring"]);
    expect(names({ colorless: true, colorMode: "exact" })).toEqual(["Sol Ring"]);
  });
});

describe("other filters", () => {
  it("sets match any owned printing, case-insensitively", () => {
    expect(names({ sets: ["gpt"] })).toEqual(["Trostani"]);
  });

  it("type ignores supertypes", () => {
    expect(cardTypes("Legendary Creature — Dryad")).toEqual(["Creature"]);
    expect(cardTypes("Instant // Sorcery")).toEqual(["Instant", "Sorcery"]);
    expect(names({ types: ["Artifact"] })).toEqual(["Sol Ring"]);
  });

  it("cards without a rarity only drop out when a rarity is asked for", () => {
    const bare = card("Mystery", ["R"]);
    expect(filterCards([bare], EMPTY_FILTERS)).toHaveLength(1);
    expect(filterCards([bare], { ...EMPTY_FILTERS, rarities: ["rare"] })).toHaveLength(0);
  });

  it("mana value range is inclusive", () => {
    expect(names({ cmcMin: 1, cmcMax: 1 })).toEqual(["Llanowar Elves", "Sol Ring"]);
  });

  it("finish, copies and lists", () => {
    expect(names({ finish: "foil" })).toEqual(["Sol Ring"]);
    expect(names({ minCopies: 4 })).toEqual(["Sol Ring"]);
    expect(names({ gameChangersOnly: true })).toEqual(["Sol Ring"]);
  });

  it("available only falls back to copies owned when the backend sends no count", () => {
    const committed = card("Committed", ["B"], { available_count: 0 });
    const legacy = card("Legacy", ["B"]); // no available_count at all
    const found = filterCards([committed, legacy], { ...EMPTY_FILTERS, availability: "available" });
    expect(found.map((c) => c.name)).toEqual(["Legacy"]);
  });

  it("isFiltered is false only for the empty state", () => {
    expect(isFiltered(EMPTY_FILTERS)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTERS, colorless: true })).toBe(true);
  });
});

describe("sorting", () => {
  const order = (key: Parameters<typeof sortCards>[1], dir: "asc" | "desc") =>
    sortCards(ALL, key, dir).map((c) => c.name);

  it("breaks ties by name", () => {
    expect(order("cmc", "asc")).toEqual(["Llanowar Elves", "Sol Ring", "Trostani", "Atraxa"]);
  });

  it("value uses the owned finish's price times copies", () => {
    expect(order("value", "desc").slice(0, 2)).toEqual(["Sol Ring", "Trostani"]);
  });

  it("color puts colorless last and multicolor after mono", () => {
    expect(order("color", "asc")).toEqual(["Llanowar Elves", "Trostani", "Atraxa", "Sol Ring"]);
  });
});

describe("search params", () => {
  it("round-trip the filters and sort", () => {
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      q: "elf",
      sets: ["gpt", "m21"],
      colors: ["G", "W"],
      colorless: true,
      colorMode: "atMost",
      cmcMax: 4,
      reservedOnly: true,
    };
    const back = fromSearchParams(toSearchParams(filters, "value", "asc"));
    expect(back).toEqual({ filters, sort: "value", dir: "asc" });
  });
});
