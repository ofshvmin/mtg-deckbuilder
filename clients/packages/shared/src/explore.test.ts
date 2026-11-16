import { describe, expect, it } from "vitest";
import type { EdhrecDeckPreview } from "./types";
import { edhrecPreviewCards } from "./explore";

const base = { coloridentity: [], url: "" };

describe("edhrecPreviewCards", () => {
  it("reads the line format, flagging commanders", () => {
    const preview: EdhrecDeckPreview = {
      ...base,
      deck: ["1 Omo, Queen of Vesuva", "10 Forest", "1 Sol Ring"],
      commanders: ["Omo, Queen of Vesuva"],
    };
    expect(edhrecPreviewCards(preview)).toEqual([
      { name: "Omo, Queen of Vesuva", quantity: 1, is_commander: true },
      { name: "Forest", quantity: 10, is_commander: false },
      { name: "Sol Ring", quantity: 1, is_commander: false },
    ]);
  });

  it("reads EDHREC's sectioned format", () => {
    const preview: EdhrecDeckPreview = {
      ...base,
      commanders: ["Omo, Queen of Vesuva"],
      deck: {
        commander: ["Omo, Queen of Vesuva"],
        commander_v2: [["Omo, Queen of Vesuva", 1]],
        cards: { Sorcery: [["All Is Dust", 1]], Land: [["Forest", 9]] },
      },
    };
    expect(edhrecPreviewCards(preview)).toEqual([
      { name: "Omo, Queen of Vesuva", quantity: 1, is_commander: true },
      { name: "All Is Dust", quantity: 1, is_commander: false },
      { name: "Forest", quantity: 9, is_commander: false },
    ]);
  });

  it("returns nothing for an unreadable deck", () => {
    expect(edhrecPreviewCards({ ...base, commanders: [], deck: {} })).toEqual([]);
  });
});
