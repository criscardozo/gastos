"use client";

// Display-only FX: AUD → USD via frankfurter (ECB rates, no key).
// Cached in localStorage by calendar day; on any failure the app silently
// shows AUD only — FX must never block.

const FX_URL = "https://api.frankfurter.dev/v1/latest?base=AUD&symbols=USD";

const CACHE_PREFIX = "gd:fx:AUD-USD:";

function cacheKey(): string {
  return `${CACHE_PREFIX}${new Date().toISOString().slice(0, 10)}`;
}

/** Most recent cached rate from any previous day — a stale approximation is
 * fine because every conversion is marked ≈. */
function latestCachedRate(): number | null {
  let bestDate = "";
  let best: number | null = null;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null || !key.startsWith(CACHE_PREFIX)) continue;
    const date = key.slice(CACHE_PREFIX.length);
    const value = Number(localStorage.getItem(key));
    if (Number.isFinite(value) && value > 0 && date > bestDate) {
      bestDate = date;
      best = value;
    }
  }
  return best;
}

export async function fetchUsdRate(): Promise<number | null> {
  try {
    const cached = localStorage.getItem(cacheKey());
    if (cached !== null) {
      const value = Number(cached);
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch {
    return null;
  }
  try {
    const res = await fetch(FX_URL);
    if (res.ok) {
      const data = (await res.json()) as { rates?: { USD?: number } };
      const rate = data.rates?.USD;
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        localStorage.setItem(cacheKey(), String(rate));
        return rate;
      }
    }
  } catch {
    // Fall through to the stale-cache fallback below.
  }
  try {
    return latestCachedRate();
  } catch {
    return null;
  }
}

/** Convert AUD cents to USD cents with a display rate. */
export function convertCents(cents: number, rate: number): number {
  return Math.round(cents * rate);
}

/** Convert USD cents to AUD cents with a display rate (rate is AUD→USD).
 * Used when a budget amount is typed in USD — the stored value is always
 * AUD integer cents. */
export function usdToAudCents(usdCents: number, rate: number): number {
  return Math.round(usdCents / rate);
}
