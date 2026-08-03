// Money display helpers. Money is ALWAYS integer cents in memory and in
// Firestore; these helpers convert to display strings only.

/** App locale → BCP 47 tag used for number formatting. */
function numberLocale(locale: string): string {
  return locale === "es" ? "es-AR" : "en-AU";
}

/** Strip the space some locales put between the symbol and the digits
 * ("$ 1.050,00" → "$1.050,00") to match the design reference. */
function tighten(formatted: string): string {
  return formatted.replace(/^(-?[^\d\s]*)[\s  ]+/, "$1");
}

/**
 * Format integer cents as a currency string, es-AR style comma decimals in
 * Spanish ("$1.050,00") and en-AU style in English ("$1,050.00").
 */
export function formatCents(
  cents: number,
  currency: string,
  locale: string,
): string {
  const formatter = new Intl.NumberFormat(numberLocale(locale), {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  });
  return tighten(formatter.format(cents / 100));
}

/** Like formatCents but drops the decimals when the amount is whole
 * ("$900" instead of "$900,00") — used in chips and compact labels. */
export function formatCentsCompact(
  cents: number,
  currency: string,
  locale: string,
): string {
  const whole = cents % 100 === 0;
  const formatter = new Intl.NumberFormat(numberLocale(locale), {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return tighten(formatter.format(cents / 100));
}

/**
 * "US$ 186,90" — the amount the bank actually charged in USD. Always exact:
 * the app no longer converts anything, it only ever displays a figure that
 * came from the bank, so there is no "≈" variant any more.
 */
export function formatUsd(cents: number, locale: string): string {
  const formatter = new Intl.NumberFormat(numberLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `US$ ${formatter.format(cents / 100)}`;
}

/**
 * Parse free-form amount input into integer cents. Accepts comma decimals
 * ("12,50"), dot decimals ("12.50") and thousand separators ("1.050,00").
 * Returns null when the input is not a positive amount.
 */
export function parseAmountToCents(input: string): number | null {
  const raw = input.replace(/[^\d.,-]/g, "").trim();
  if (raw === "") return null;
  let normalized: string;
  if (raw.includes(",")) {
    // Comma is the decimal separator; dots are thousand separators.
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = raw;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return cents > 0 ? cents : null;
}
