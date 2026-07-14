import * as SecureStore from "expo-secure-store";
import type { TokenStore } from "@mtg/shared";

const ACCESS_KEY = "mtg.access";
const REFRESH_KEY = "mtg.refresh";

/** TokenStore backed by expo-secure-store (encrypted on-device storage). */
export const secureTokenStore: TokenStore = {
  async getAccess() {
    return SecureStore.getItemAsync(ACCESS_KEY);
  },
  async getRefresh() {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },
  async setTokens(access: string, refresh: string) {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  async clear() {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};
