import { describe, expect, it } from "vitest";
import type { DeckCard, GeneratedDeck } from "./types";
import { compareDeckCards, groupBySlot } from "./deckCompare";

function card(oracle_id: string, slot: string, count = 1): DeckCard {
  return {
    oracle_id, name: oracle_id, mana_cost: "", cmc: 0, type_line: "", color_identity: [],
    roles: [], slot, reason: "", count, quality: 0, in_combo: false,
  };
}

const deck = (cards: DeckCard[]) => ({ cards }) as GeneratedDeck;

describe("compareDeckCards", () => {
  const a = deck([card("Sol Ring", "ramp"), card("Forest", "land", 10), card("Swords", "removal")]);
  const b = deck([card("Sol Ring", "ramp"), card("Forest", "land", 12), card("Counterspell", "removal")]);
  const { shared, onlyA, onlyB } = compareDeckCards(a, b);

  it("splits shared and unique cards", () => {
    expect(shared.map((c) => c.name).sort()).toEqual(["Forest", "Sol Ring"]);
    expect(onlyA.map((c) => c.name)).toEqual(["Swords"]);
    expect(onlyB.map((c) => c.name)).toEqual(["Counterspell"]);
  });

  it("keeps both counts for shared cards", () => {
    expect(shared.find((c) => c.name === "Forest")).toMatchObject({ countA: 10, countB: 12 });
  });

  it("groups by role in slot order, alphabetically", () => {
    expect(groupBySlot(shared).map((g) => g.label)).toEqual(["Lands", "Ramp"]);
  });
});
