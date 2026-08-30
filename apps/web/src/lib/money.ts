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
 * "$ 241.402,75" — Argentine pesos, always in es-AR regardless of the app's
 * language. A peso figure written with English separators reads as a different
 * number to the person comparing it against a BBVA statement, and this figure
 * exists only to be compared against one.
 */
export function formatArs(cents: number): string {
  const formatter = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$ ${formatter.format(cents / 100)}`;
}

/**
 * Parse free-form amount input into integer cents, in the caller's locale.
 *
 * The locale is not decoration: without it the two separators cannot be told
 * apart, and the old version assumed "." was always thousands and "," always
 * decimal. That made the app unable to re-read its own output — in en-AU it
 * turned the "$1,050.00" it had just printed into 105 cents, and in es-AR the
 * perfectly ordinary "1.050" into 1,05. A thousandth of the intended amount,
 * plausible enough to be written to the ledger unnoticed.
 *
 * The rules, in order:
 *   - both separators present → the LAST one is the decimal point;
 *   - one separator, and it is the locale's decimal → decimal;
 *   - one separator, and it is the locale's grouping mark → grouping, but only
 *     if it is followed by exactly three digits. "1.050" groups; "12.50" and
 *     "1.5" do not, and nobody typing those means fifteen hundredths, so they
 *     are read as decimals.
 *
 * Returns null when the input is not a positive amount.
 */
/**
 * The largest amount the security rules accept (1..10_000_000 cents, so
 * $100.000). It lived in datos/page.tsx, which meant the CSV import was the
 * only screen that checked it: typing $200.000 into the entry form passed the
 * client, reached the server and was refused there — silently, because a
 * refused write had no way to say so.
 */
export const MAX_AMOUNT_CENTS = 10_000_000;

/**
 * `max` exists for the peso fields on the Tarjetas screen: an ARS figure is
 * three orders of magnitude larger than an AUD one, so the ledger's ceiling
 * would refuse a perfectly ordinary bank fee. Every ledger caller leaves it
 * alone and keeps the limit the security rules enforce.
 */
export function parseAmountToCents(
  input: string,
  locale: string,
  max: number = MAX_AMOUNT_CENTS,
): number | null {
  const raw = input.replace(/[^\d.,-]/g, "").trim();
  if (raw === "") return null;

  const decimalMark = locale === "es" ? "," : ".";
  const groupMark = locale === "es" ? "." : ",";
  const hasDecimal = raw.includes(decimalMark);
  const hasGroup = raw.includes(groupMark);

  let normalized: string;
  if (hasDecimal && hasGroup) {
    // Whichever comes last is the decimal point; the other groups digits.
    const decimalIsLast = raw.lastIndexOf(decimalMark) > raw.lastIndexOf(groupMark);
    const [decimal, group] = decimalIsLast
      ? [decimalMark, groupMark]
      : [groupMark, decimalMark];
    normalized = raw.split(group).join("").split(decimal).join(".");
  } else if (hasDecimal) {
    normalized = raw.split(decimalMark).join(".");
  } else if (hasGroup) {
    // Grouping only if it actually groups: three digits after every mark.
    const parts = raw.split(groupMark);
    const groups = parts.slice(1).every((part) => /^\d{3}$/.test(part));
    normalized = groups ? parts.join("") : parts.join(".");
  } else {
    normalized = raw;
  }

  // More than one "." left means the input was never a number.
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  if (cents <= 0 || cents > max) return null;
  return cents;
}
