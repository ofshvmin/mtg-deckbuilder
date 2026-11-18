import { describe, expect, it } from "vitest";
import { buyList, buyListText, missingCopies, storeName } from "./buyList";
import type { DeckCard, Printing } from "./types";

function card(name: string, count: number, extra: Partial<DeckCard> = {}): DeckCard {
  return {
    oracle_id: name.toLowerCase(),
    name,
    mana_cost: "",
    cmc: 1,
    type_line: "Instant",
    color_identity: [],
    roles: [],
    slot: "game_plan",
    reason: "",
    count,
    quality: 0,
    in_combo: false,
    ...extra,
  };
}

function owned(n: number): Printing[] {
  return [{ printing_key: "k", edition: "m21", collector_number: "1", finish: "nonfoil", condition: null, language: null, count: n }];
}

describe("missingCopies", () => {
  it("imported decks: a card with no owned printing is all missing", () => {
    expect(missingCopies(card("Bolt", 4), true)).toBe(4);
  });

  it("counts partial ownership", () => {
    expect(missingCopies(card("Bolt", 4, { printings: owned(1) }), true)).toBe(3);
    expect(missingCopies(card("Bolt", 4, { printings: owned(5) }), true)).toBe(0);
  });

  it("older saved decks without printings don't read as owning nothing", () => {
    expect(missingCopies(card("Bolt", 1), false)).toBe(0);
  });

  it("an explicit empty printing list is missing anywhere (an upgrade to buy)", () => {
    expect(missingCopies(card("Bolt", 2, { printings: [] }), false)).toBe(2);
  });

  it("cards claimed by another deck are missing", () => {
    expect(missingCopies(card("Bolt", 1, { printings: owned(1), short: true }), false)).toBe(1);
  });

  it("never lists basic lands", () => {
    expect(missingCopies(card("Forest", 20, { oracle_id: "basic:G", type_line: "Basic Land — Forest" }), true)).toBe(0);
    expect(missingCopies(card("Snow-Covered Forest", 2, { type_line: "Basic Snow Land — Forest" }), true)).toBe(0);
  });
});

describe("storeName", () => {
  it("double-faced cards use the front face", () => {
    expect(
      storeName({ name: "Delver of Secrets // Insectile Aberration", type_line: "Creature — Human Wizard // Creature — Human Insect", image_uris_back: { normal: "x" } }),
    ).toBe("Delver of Secrets");
  });

  it("adventures use the creature's name", () => {
    expect(
      storeName({ name: "Bonecrusher Giant // Stomp", type_line: "Creature — Giant // Instant — Adventure" }),
    ).toBe("Bonecrusher Giant");
  });

  it("split cards keep both halves", () => {
    expect(storeName({ name: "Fire // Ice", type_line: "Instant // Instant" })).toBe("Fire // Ice");
  });
});

describe("buyList", () => {
  it("lists only what's missing, merged by store name and sorted", () => {
    const cards = [
      card("Sol Ring", 1, { printings: owned(1) }),
      card("Counterspell", 2, { printings: owned(1) }),
      card("Bonecrusher Giant // Stomp", 1, { type_line: "Creature — Giant // Instant — Adventure" }),
      card("Arcane Signet", 1),
    ];
    const lines = buyList(cards, true);
    expect(buyListText(lines)).toBe("1 Arcane Signet\n1 Bonecrusher Giant\n1 Counterspell");
  });
});
