import { CARD_CHOICES, type CardChoice } from "@mtg/shared";

// Card choice is a standing preference, like the pool filters: the setting you
// built with also drives rebuilds and manual-builder suggestions.
const KEY = "mtg.cardChoice";

export function storedCardChoice(): CardChoice {
  const raw = localStorage.getItem(KEY);
  return CARD_CHOICES.some((c) => c.key === raw) ? (raw as CardChoice) : "balanced";
}

export function saveCardChoice(choice: CardChoice): void {
  localStorage.setItem(KEY, choice);
}

/** Request field for a choice — omitted for Balanced, which is the server default. */
export function cardChoiceField(choice: CardChoice): { card_choice?: CardChoice } {
  return choice === "balanced" ? {} : { card_choice: choice };
}
