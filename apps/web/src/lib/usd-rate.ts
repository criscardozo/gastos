// The peso-per-dollar rate used to estimate what a card statement will cost.
//
// The ONLY place this project talks to an exchange-rate service, and it is not
// the ledger: an expense is AUD integer cents and no total ever converts
// anything, which is what keeps the budget deterministic and offline-safe. This
// is the Tarjetas screen estimating the ARS side of a USD statement, where being
// approximately right beats showing nothing.
//
// MAYORISTA, not oficial. BBVA converts the whole statement at ONE rate, and
// the statement prints it in the RG 5617 base: 3.659.064,68 / US$ 2.412,04 =
// 1517,00 on the statement closing 2026-10-01, which is the mayorista selling
// rate of that very day. The oficial (retail) one was 1540 — 1,5% high, and
// that alone moved the estimate by $ 17.000. The statement before it (closing
// 2026-08-27) used 1514, the mayorista of the day BEFORE closing; the closing
// day's was 1512. So the closing day is exact on one statement and 0,13% off
// on the other — the best single rule two statements support. If a third
// disagrees, this is where to start.
//
// Which day: a statement already closed is valued at its closing day's rate,
// fetched from argentinadatos.com (history by date). The open one can only be
// valued at today's, from dolarapi.com. Both are free, need no key and answer
// with `access-control-allow-origin: *`, which matters because this runs in
// the browser.
//
// Never "tarjeta". That quote already has the percepciones baked in — using it
// here would charge them twice, once inside the rate and once as the lines this
// screen adds.

/** Falls back to this when the network says nothing useful. */
export interface RateSource {
  rate: number;
  /** Where it came from, so the screen can say so rather than assert a fact. */
  origin: "api" | "manual";
  /** ISO day the quote belongs to, when the API gave one. */
  asOf?: string;
}

const TODAY_URL = "https://dolarapi.com/v1/dolares/mayorista";
const HISTORY_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/mayorista";

/**
 * Today's mayorista selling rate, or null when it cannot be had.
 *
 * Never throws: a screen that cannot reach an exchange-rate service must still
 * render, so the caller falls back to the household's stored rate. Aborts
 * rather than hanging — a slow quote is worth less than a screen that paints.
 */
export function fetchTodayRate(
  timeoutMs = 4000,
): Promise<{ rate: number; asOf: string } | null> {
  return fetchQuote(TODAY_URL, "fechaActualizacion", timeoutMs);
}

/**
 * The mayorista selling rate of `day` ("YYYY-MM-DD"), or null. The service
 * answers weekends and holidays with the last business day's quote.
 */
export function fetchRateOn(
  day: string,
  timeoutMs = 4000,
): Promise<{ rate: number; asOf: string } | null> {
  return fetchQuote(`${HISTORY_URL}/${day.replaceAll("-", "/")}`, "fecha", timeoutMs);
}

/**
 * The rate a statement is valued at: its closing day's once it has closed
 * (`today` is past or on it), today's while it is still open — and today's too
 * when the history service says nothing, because a near rate beats none.
 */
export async function fetchStatementRate(
  closingDate: string,
  today: string,
): Promise<{ rate: number; asOf: string } | null> {
  if (closingDate <= today) {
    const onClosing = await fetchRateOn(closingDate);
    if (onClosing !== null) return onClosing;
  }
  return fetchTodayRate();
}

async function fetchQuote(
  url: string,
  dateField: string,
  timeoutMs: number,
): Promise<{ rate: number; asOf: string } | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const rate = (data as { venta?: unknown }).venta;
    const asOf = (data as Record<string, unknown>)[dateField];
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
