"use client";

// Display-only FX: AUD → USD via frankfurter (ECB rates, no key).
// Cached in localStorage by calendar day; on any failure the app silently
// shows AUD only — FX must never block.

const FX_URL = "https://api.frankfurter.dev/v1/latest?base=AUD&symbols=USD";

function cacheKey(): string {
  return `gd:fx:AUD-USD:${new Date().toISOString().slice(0, 10)}`;
}

export async function fetchUsdRate(): Promise<number | null> {
  try {
    const cached = localStorage.getItem(cacheKey());
    if (cached !== null) {
      const value = Number(cached);
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    const res = await fetch(FX_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { USD?: number } };
    const rate = data.rates?.USD;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      return null;
    }
    localStorage.setItem(cacheKey(), String(rate));
    return rate;
  } catch {
    return null;
  }
}

/** Convert AUD cents to USD cents with a display rate. */
export function convertCents(cents: number, rate: number): number {
  return Math.round(cents * rate);
}
