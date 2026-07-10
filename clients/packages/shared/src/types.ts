// Shared API types. Framework-agnostic — imported by web and future mobile.
// Keep in sync with the backend's Pydantic models.

export interface HealthStatus {
  status: string;
  service: string;
  version: string;
  db_configured: boolean;
  db_connected: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string; // "bearer"
}

export interface User {
  id: string;
  email: string;
  created_at: string;
}

// --- Card / deck domain ---

export type Color = "W" | "U" | "B" | "R" | "G";

export interface CollectionSummary {
  has_collection: boolean;
  total_cards: number;
  unique_cards: number;
}

export interface ImportResult {
  total: number;
  matched: number;
  unmatched: number;
  unique_owned: number;
  unmatched_names: string[];
  detected_format?: string;
}

export interface CollectionItem {
  oracle_id: string | null;
  name: string;
  count: number;
  edition?: string | null;
  condition?: string | null;
  foil?: string | null;
}

export interface CardSearchResult {
  oracle_id: string;
  name: string;
  type_line: string;
  mana_cost: string;
}

export interface CommanderOption {
  oracle_id: string;
  name: string;
  type_line: string;
  color_identity: Color[];
}

export interface CardSummary {
  oracle_id: string;
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  color_identity: Color[];
  oracle_text: string;
}

export interface PoolCard {
  oracle_id: string;
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  color_identity: Color[];
  copies_owned: number;
  is_land: boolean;
}

export interface CurveBucket {
  cmc: number; // 0..7 (7 = "7+")
  count: number;
}

export interface PoolResponse {
  commander: CardSummary;
  color_identity: Color[];
  pool_size: number;
  land_count: number;
  curve: CurveBucket[];
  pool: PoolCard[];
}

// One owned printing (physical inventory unit) of a card: which set it's from,
// its collector number, finish, and condition — the detail needed to locate the
// paper card and, later, to value and allocate it.
export interface Printing {
  printing_key: string;
  edition: string | null;
  collector_number: string | null;
  finish: string; // "foil" | "nonfoil"
  condition: string | null;
  language: string | null;
  count: number;
}

export interface DeckCard {
  oracle_id: string;
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  color_identity: Color[];
  roles: string[];
  slot: string; // land | ramp | card_draw | removal | board_wipe | game_plan
  reason: string;
  count: number;
  quality: number; // EDHREC quality score (0 if unknown)
  in_combo: boolean;
  printings?: Printing[]; // owned printings (absent/empty for basics + pre-existing saved decks)
  selected_printing_key?: string | null; // which owned copy this deck earmarks
}

export interface Combo {
  id: string;
  cards: string[];
  produces: string[];
  popularity: number;
  missing_name: string | null; // set only for "near" (one-card-away) combos
}

export interface GeneratedDeck {
  commander: CardSummary;
  color_identity: Color[];
  total: number;
  land_count: number;
  nonland_count: number;
  role_counts: Record<string, number>;
  curve: CurveBucket[];
  color_sources: Record<string, number>;
  stats: Record<string, number>;
  warnings: string[];
  edhrec_available: boolean;
  combos: Combo[];
  near_combos: Combo[];
  cards: DeckCard[];
}

export interface SavedDeck {
  id: string;
  name: string;
  deck: GeneratedDeck;
  created_at: string;
  updated_at: string;
}

export interface SavedDeckSummary {
  id: string;
  name: string;
  commander_name: string;
  color_identity: Color[];
  total: number;
  created_at: string;
  updated_at: string;
}
