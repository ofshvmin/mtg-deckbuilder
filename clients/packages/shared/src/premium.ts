import { ApiError } from "./client";

/**
 * True when an error is the backend's "Premium required" response (HTTP 402) —
 * either the AI deck brief or the free-tier saved-deck cap. Callers surface an
 * upgrade prompt instead of a generic error: the iOS app opens its paywall; the
 * web app, which can't sell Premium, points at the iOS app.
 */
export function isPremiumRequired(e: unknown): boolean {
  return e instanceof ApiError && e.status === 402;
}
