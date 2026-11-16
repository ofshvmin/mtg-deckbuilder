import { describe, expect, it } from "vitest";
import type { DeckCard } from "./types";
import { buildLibrary } from "./playtest";

function card(oracle_id: string, count = 1, type_line = "Creature"): DeckCard {
  return {
    oracle_id, name: oracle_id, mana_cost: "", cmc: 0, type_line, color_identity: [],
    roles: [], slot: "game_plan", reason: "", count, quality: 0, in_combo: false,
  };
}

describe("buildLibrary", () => {
  it("expands counts into one entry per copy", () => {
    expect(buildLibrary([card("forest", 3, "Basic Land")])).toHaveLength(3);
  });

  it("gives every copy a unique uid, even when a card is listed twice", () => {
    const lib = buildLibrary([card("sol-ring"), card("sol-ring", 2)]);
    expect(new Set(lib.map((c) => c.uid)).size).toBe(3);
  });
});
