// Web app's ApiClient instance: the shared client wired to a localStorage-backed
// TokenStore. (A React Native app would instead back this with expo-secure-store.)
import { ApiClient, type TokenStore } from "@mtg/shared";

const ACCESS_KEY = "mtg.access";
const REFRESH_KEY = "mtg.refresh";

const localTokenStore: TokenStore = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setTokens: (access, refresh) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// The AuthProvider registers a handler here so a failed refresh can clear
// user state and bounce to /login, without the shared client knowing about React.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

export const api = new ApiClient({
  baseUrl,
  tokenStore: localTokenStore,
  onUnauthorized: () => unauthorizedHandler?.(),
});
