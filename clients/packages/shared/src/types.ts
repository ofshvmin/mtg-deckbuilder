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

// --- Card / deck domain (expanded in later phases) ---

export type Color = "W" | "U" | "B" | "R" | "G";

export interface Card {
  oracle_id: string;
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
  color_identity: Color[];
  produced_mana: Color[] | null;
  legal_commander: string;
  is_basic_land: boolean;
}

export interface OwnedCard extends Card {
  copies_owned: number;
}

export interface PoolResult {
  commander: Card;
  color_identity: Color[];
  pool: OwnedCard[];
}
