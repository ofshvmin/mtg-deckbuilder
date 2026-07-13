// Framework-agnostic API client. Uses global `fetch` (present in browsers,
// React Native, and modern Node) and NO DOM/React APIs, so both the web app
// and a future React Native app can share it unchanged.
//
// Token storage is injected via `TokenStore` — web supplies a localStorage
// implementation, mobile supplies expo-secure-store. On a 401 the client tries
// the refresh token once, then gives up and calls `onUnauthorized`.

import type {
  AuthTokens,
  BatchAddResult,
  BriefDeckResponse,
  CardSearchResult,
  ComboFinisher,
  CollectionCard,
  CollectionItem,
  CollectionSummary,
  CommanderOption,
  ExternalDeckResponse,
  GeneratedDeck,
  HealthStatus,
  ImportResult,
  PoolResponse,
  SavedDeck,
  SavedDeckSummary,
  StrategyOption,
  UpgradeSuggestion,
  User,
} from "./types";

/** Pluggable token persistence. Sync or async to fit any platform. */
export interface TokenStore {
  getAccess(): string | null | Promise<string | null>;
  getRefresh(): string | null | Promise<string | null>;
  setTokens(access: string, refresh: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
  /** Called when a request is unauthorized and refresh fails (e.g. redirect to login). */
  onUnauthorized?: () => void;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiClient {
  private baseUrl: string;
  private tokens: TokenStore;
  private onUnauthorized?: () => void;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.tokens = opts.tokenStore;
    this.onUnauthorized = opts.onUnauthorized;
  }

  // ---- Public API surface ----

  health(): Promise<HealthStatus> {
    return this.request<HealthStatus>("GET", "/health", { auth: false });
  }

  async register(email: string, password: string): Promise<AuthTokens> {
    const tokens = await this.request<AuthTokens>("POST", "/auth/register", {
      auth: false,
      body: { email, password },
    });
    await this.tokens.setTokens(tokens.access_token, tokens.refresh_token);
    return tokens;
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const tokens = await this.request<AuthTokens>("POST", "/auth/login", {
      auth: false,
      body: { email, password },
    });
    await this.tokens.setTokens(tokens.access_token, tokens.refresh_token);
    return tokens;
  }

  me(): Promise<User> {
    return this.request<User>("GET", "/auth/me");
  }

  /** Update user preferences (e.g. max price for recommended cards). */
  updatePreferences(prefs: { max_card_price: number | null }): Promise<User> {
    return this.request<User>("PATCH", "/auth/preferences", { body: prefs });
  }

  async logout(): Promise<void> {
    await this.tokens.clear();
  }

  // ---- Collection ----

  collectionSummary(): Promise<CollectionSummary> {
    return this.request<CollectionSummary>("GET", "/collection/summary");
  }

  listCollection(): Promise<CollectionItem[]> {
    return this.request<CollectionItem[]>("GET", "/collection/items");
  }

  /** Distinct owned cards (one per oracle_id) with oracle data + owned printings. */
  listCollectionCards(): Promise<CollectionCard[]> {
    return this.request<CollectionCard[]>("GET", "/collection/cards");
  }

  addCard(input: {
    name: string;
    count?: number;
    oracleId?: string;
    edition?: string | null;
    collectorNumber?: string | null;
    finish?: string | null;
    condition?: string | null;
    purchasePrice?: number | null;
    language?: string | null;
  }): Promise<CollectionItem> {
    return this.request<CollectionItem>("POST", "/collection/items", {
      body: {
        name: input.name,
        count: input.count ?? 1,
        oracle_id: input.oracleId,
        edition: input.edition,
        collector_number: input.collectorNumber,
        finish: input.finish,
        condition: input.condition,
        purchase_price: input.purchasePrice,
        language: input.language,
      },
    });
  }

  removeCard(oracleId: string): Promise<void> {
    return this.request("DELETE", `/collection/items/${encodeURIComponent(oracleId)}`);
  }

  searchCards(query: string, limit = 20): Promise<CardSearchResult[]> {
    const qs = `?q=${encodeURIComponent(query)}&limit=${limit}`;
    return this.request<CardSearchResult[]>("GET", `/collection/search-cards${qs}`);
  }

  importCollection(file: Blob, filename = "collection.csv", format?: string): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file, filename);
    if (format) form.append("format", format);
    return this.request<ImportResult>("POST", "/collection/import", { body: form });
  }

  exportCollectionUrl(format = "Moxfield"): string {
    return `${this.baseUrl}/collection/export?format=${encodeURIComponent(format)}`;
  }

  async exportCollectionBlob(format = "Moxfield"): Promise<Blob> {
    const access = await this.tokens.getAccess();
    const headers: Record<string, string> = {};
    if (access) headers["Authorization"] = `Bearer ${access}`;
    const res = await fetch(
      `${this.baseUrl}/collection/export?format=${encodeURIComponent(format)}`,
      { headers },
    );
    if (!res.ok) throw new ApiError(res.status, "Export failed");
    return res.blob();
  }

  // ---- Commanders & pool ----

  searchCommanders(query: string, limit = 20): Promise<CommanderOption[]> {
    const qs = `?q=${encodeURIComponent(query)}&limit=${limit}`;
    return this.request<CommanderOption[]>("GET", `/commanders${qs}`);
  }

  getPool(commanderName: string): Promise<PoolResponse> {
    return this.request<PoolResponse>(
      "GET",
      `/pool?commander=${encodeURIComponent(commanderName)}`,
    );
  }

  listStrategies(): Promise<StrategyOption[]> {
    return this.request<StrategyOption[]>("GET", "/decks/strategies");
  }

  /** EDHREC-recommended cards the user doesn't own for a commander (budget upgrades). */
  getUpgrades(commanderName: string, limit = 40): Promise<UpgradeSuggestion[]> {
    const qs = `?commander=${encodeURIComponent(commanderName)}&limit=${limit}`;
    return this.request<UpgradeSuggestion[]>("GET", `/decks/upgrades${qs}`);
  }

  generateDeck(
    commanderName: string,
    opts?: {
      land_count?: number;
      quotas?: Record<string, number>;
      strategy?: string;
      theme?: string;
      locked?: string[];
    },
  ): Promise<GeneratedDeck> {
    return this.request<GeneratedDeck>("POST", "/decks/generate", {
      body: { commander: commanderName, ...opts },
    });
  }

  /** Interpret a natural-language deck request with Claude, then build the deck. */
  briefDeck(commanderName: string, brief: string): Promise<BriefDeckResponse> {
    return this.request<BriefDeckResponse>("POST", "/decks/brief", {
      body: { commander: commanderName, brief },
    });
  }

  /** Analyze an exact chosen card list into deck categories + stats (manual builder). */
  composeDeck(commanderName: string, oracleIds: string[]): Promise<GeneratedDeck> {
    return this.request<GeneratedDeck>("POST", "/decks/compose", {
      body: { commander: commanderName, oracle_ids: oracleIds },
    });
  }

  /** Cards that would complete a combo with the given deck cards (owned first). */
  getComboFinishers(commanderName: string, oracleIds: string[]): Promise<ComboFinisher[]> {
    return this.request<ComboFinisher[]>("POST", "/decks/combo-finishers", {
      body: { commander: commanderName, oracle_ids: oracleIds },
    });
  }

  // ---- Explore (external decks) ----

  fetchExternalDeck(opts: { url?: string; archidektId?: string }): Promise<ExternalDeckResponse> {
    const params = new URLSearchParams();
    if (opts.url) params.set("url", opts.url);
    if (opts.archidektId) params.set("archidekt_id", opts.archidektId);
    return this.request<ExternalDeckResponse>("GET", `/explore/deck?${params.toString()}`);
  }

  /** Resolve a card list (from client-side EDHREC fetch) against our DB. */
  resolveExternalDeck(body: {
    cards: { name: string; quantity: number; is_commander: boolean }[];
    source: string;
    source_url: string;
    name: string;
    owner: string;
  }): Promise<ExternalDeckResponse> {
    return this.request<ExternalDeckResponse>("POST", "/explore/resolve", { body });
  }

  batchAddToCollection(
    cards: { name: string; oracle_id?: string; edition?: string; collector_number?: string; finish?: string; count?: number }[],
    mode: "ignore_duplicates" | "import_all",
  ): Promise<BatchAddResult> {
    return this.request<BatchAddResult>("POST", "/collection/batch-add", {
      body: { cards, mode },
    });
  }

  // ---- Saved decks ----

  saveDeck(name: string, deck: GeneratedDeck, opts?: { source?: string; source_url?: string }): Promise<SavedDeck> {
    return this.request<SavedDeck>("POST", "/decks/save", { body: { name, deck, ...opts } });
  }

  listSavedDecks(): Promise<SavedDeckSummary[]> {
    return this.request<SavedDeckSummary[]>("GET", "/decks/saved");
  }

  getSavedDeck(deckId: string): Promise<SavedDeck> {
    return this.request<SavedDeck>("GET", `/decks/saved/${encodeURIComponent(deckId)}`);
  }

  updateSavedDeck(deckId: string, updates: { name?: string; deck?: GeneratedDeck }): Promise<SavedDeck> {
    return this.request<SavedDeck>("PUT", `/decks/saved/${encodeURIComponent(deckId)}`, { body: updates });
  }

  deleteSavedDeck(deckId: string): Promise<void> {
    return this.request("DELETE", `/decks/saved/${encodeURIComponent(deckId)}`);
  }

  async exportDeckBlob(deckId: string, format = "Moxfield"): Promise<Blob> {
    const access = await this.tokens.getAccess();
    const headers: Record<string, string> = {};
    if (access) headers["Authorization"] = `Bearer ${access}`;
    const res = await fetch(
      `${this.baseUrl}/decks/saved/${encodeURIComponent(deckId)}/export?format=${encodeURIComponent(format)}`,
      { headers },
    );
    if (!res.ok) throw new ApiError(res.status, "Export failed");
    return res.blob();
  }

  // ---- Core request machinery ----

  private async request<T>(
    method: string,
    path: string,
    opts: { auth?: boolean; body?: unknown; _retried?: boolean } = {},
  ): Promise<T> {
    const { auth = true, body, _retried = false } = opts;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const headers: Record<string, string> = { Accept: "application/json" };
    // For FormData, let fetch set Content-Type (with the multipart boundary).
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (auth) {
      const access = await this.tokens.getAccess();
      if (access) headers["Authorization"] = `Bearer ${access}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });

    if (res.status === 401 && auth && !_retried) {
      if (await this.tryRefresh()) {
        return this.request<T>(method, path, { ...opts, _retried: true });
      }
      await this.tokens.clear();
      this.onUnauthorized?.();
    }

    if (!res.ok) {
      const errBody = await this.safeJson(res);
      const message =
        (errBody as { detail?: string })?.detail || `Request failed (${res.status})`;
      throw new ApiError(res.status, message, errBody);
    }

    return (await this.safeJson(res)) as T;
  }

  private async tryRefresh(): Promise<boolean> {
    const refresh = await this.tokens.getRefresh();
    if (!refresh) return false;
    try {
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const tokens = (await res.json()) as AuthTokens;
      await this.tokens.setTokens(tokens.access_token, tokens.refresh_token);
      return true;
    } catch {
      return false;
    }
  }

  private async safeJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
