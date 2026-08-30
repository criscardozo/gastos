// The peso-per-dollar rate used to estimate what a card statement will cost.
//
// The ONLY place this project talks to an exchange-rate service, and it is not
// the ledger: an expense is AUD integer cents and no total ever converts
// anything, which is what keeps the budget deterministic and offline-safe. This
// is the Tarjetas screen estimating the ARS side of a USD statement, where being
// approximately right beats showing nothing.
//
// dolarapi.com is free, needs no key, and answers with
// `access-control-allow-origin: *`, which matters because this runs in the
// browser. Verified against Cristian's statement: valuing the purchases at the
// official selling rate of each purchase's own day reproduces the bank's base to
// within 0.08%.
//
// OFICIAL, not "tarjeta". The tarjeta quote already has the percepciones baked
// in — using it here would charge them twice, once inside the rate and once as
// the lines this screen adds.

/** Falls back to this when the network says nothing useful. */
export interface RateSource {
  rate: number;
  /** Where it came from, so the screen can say so rather than assert a fact. */
  origin: "api" | "manual";
  /** ISO day the quote belongs to, when the API gave one. */
  asOf?: string;
}

const TODAY_URL = "https://dolarapi.com/v1/dolares/oficial";

/**
 * Today's official selling rate, or null when it cannot be had.
 *
 * Never throws: a screen that cannot reach an exchange-rate service must still
 * render, so the caller falls back to the household's stored rate. Aborts
 * rather than hanging — a slow quote is worth less than a screen that paints.
 */
export async function fetchTodayRate(
  timeoutMs = 4000,
): Promise<{ rate: number; asOf: string } | null> {
  try {
    const response = await fetch(TODAY_URL, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const rate = (data as { venta?: unknown }).venta;
    const asOf = (data as { fechaActualizacion?: unknown }).fechaActualizacion;
    // A rate that is not a positive number is not a rate. Guarded because a
    // wrong number here multiplies straight into a figure about money.
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      return null;
    }
    return {
      rate,
      asOf: typeof asOf === "string" ? asOf.slice(0, 10) : "",
    };
  } catch {
    return null;
  }
}

/** The API's rate when there is one, the household's stored one otherwise. */
export function resolveRate(
  fromApi: { rate: number; asOf: string } | null,
  storedRate: number | null,
): RateSource | null {
  if (fromApi !== null) {
    return { rate: fromApi.rate, origin: "api", asOf: fromApi.asOf };
  }
  if (storedRate !== null && storedRate > 0) {
    return { rate: storedRate, origin: "manual" };
  }
  return null;
}
