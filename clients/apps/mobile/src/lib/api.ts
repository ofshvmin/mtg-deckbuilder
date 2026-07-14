import { ApiClient } from "@mtg/shared";
import { secureTokenStore } from "./tokenStore";
import { router } from "expo-router";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://mtg-deckbuilder-api.fly.dev";

export const api = new ApiClient({
  baseUrl: API_BASE_URL,
  tokenStore: secureTokenStore,
  onUnauthorized: () => {
    router.replace("/login");
  },
});
