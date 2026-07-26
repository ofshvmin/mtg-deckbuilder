import { ApiError } from "@mtg/shared";

/**
 * True when an error is the backend's "Premium required" response (HTTP 402) —
 * either the AI deck brief or the free-tier saved-deck cap. The web app can't
 * sell Premium (purchases happen in the iOS app), so callers surface an
 * "upgrade in the app" prompt instead of a generic error.
 */
export function isPremiumRequired(e: unknown): boolean {
  return e instanceof ApiError && e.status === 402;
}
