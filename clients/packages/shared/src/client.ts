// Framework-agnostic API client. Uses global `fetch` (present in browsers,
// React Native, and modern Node) and NO DOM/React APIs, so both the web app
// and a future React Native app can share it unchanged.
//
// Token storage is injected via `TokenStore` — web supplies a localStorage
// implementation, mobile supplies expo-secure-store. On a 401 the client tries
// the refresh token once, then gives up and calls `onUnauthorized`.

import type { AuthTokens, HealthStatus, User } from "./types";

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

  async logout(): Promise<void> {
    await this.tokens.clear();
  }

  // ---- Core request machinery ----

  private async request<T>(
    method: string,
    path: string,
    opts: { auth?: boolean; body?: unknown; _retried?: boolean } = {},
  ): Promise<T> {
    const { auth = true, body, _retried = false } = opts;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const access = await this.tokens.getAccess();
      if (access) headers["Authorization"] = `Bearer ${access}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
