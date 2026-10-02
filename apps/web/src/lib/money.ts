// Money display helpers. Money is ALWAYS integer cents in memory and in
// Firestore; these helpers convert to display strings only.

// ONE number format for the whole app, in both languages: a point for the
// decimals and nothing grouping the thousands — "$1050.00", "US$ 186.90",
// "$ 241402.75". Cristian's call on 2026-10-02. Until then Spanish followed
// es-AR ("$1.050,00") and English en-AU ("$1,050.00").
//
// The number is formatted in en-AU, which already writes a point, with the
// grouping turned off; the LANGUAGE of the app no longer enters into it, which
// is why the `locale` parameters below are kept but unused — every caller
// passes one, and dates still follow it (lib/dates.ts).
//
// iOS still writes es-AR until it is moved too.
const NUMBER_LOCALE = "en-AU";

/** Strip the space some locales put between the symbol and the digits
 * ("$ 1050.00" → "$1050.00") to match the design reference. */
function tighten(formatted: string): string {
  return formatted.replace(/^(-?[^\d\s]*)[\s  ]+/, "$1");
}

/** Integer cents as a currency string: "$1050.00". */
export function formatCents(
  cents: number,
  currency: string,
  _locale: string,
): string {
  const formatter = new Intl.NumberFormat(NUMBER_LOCALE, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    useGrouping: false,
  });
  return tighten(formatter.format(cents / 100));
}

/** Like formatCents but drops the decimals when the amount is whole
 * ("$900" instead of "$900.00") — used in chips and compact labels. */
export function formatCentsCompact(
  cents: number,
  currency: string,
  _locale: string,
): string {
  const whole = cents % 100 === 0;
  const formatter = new Intl.NumberFormat(NUMBER_LOCALE, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    useGrouping: false,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return tighten(formatter.format(cents / 100));
}

/**
 * "US$ 186.90" — the amount the bank actually charged in USD. Always exact:
 * the app no longer converts anything, it only ever displays a figure that
 * came from the bank, so there is no "≈" variant any more.
 */
export function formatUsd(cents: number, _locale: string): string {
  const formatter = new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
  return `US$ ${formatter.format(cents / 100)}`;
}

/**
 * "$ 241402.75" — Argentine pesos. They were kept in es-AR ("$ 241.402,75")
 * whatever the language, to read like a BBVA statement; since 2026-10-02 they
 * follow the app's one format like everything else (Cristian's call).
 */
export function formatArs(cents: number): string {
  const formatter = new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
  return `$ ${formatter.format(cents / 100)}`;
}

/**
 * Parse free-form amount input into integer cents.
 *
 * It must re-read whatever the app prints — an old version could not, and
 * turned a "$1,050.00" it had just written into 105 cents: a thousandth of
 * the amount, plausible enough to reach the ledger unnoticed.
 *
 * The rules, in order (the point is the decimal mark; see NUMBER_LOCALE):
 *   - both separators present → the LAST one is the decimal point;
 *   - only points → decimal;
 *   - only commas → grouping, but only if each is followed by exactly three
 *     digits. "1,050" groups; "12,50" and "1,5" do not, and nobody typing
 *     those means fifteen hundredths, so they are read as decimals.
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
 * Integer cents as an editable figure ("6390" → "63.90"), for pre-filling an
 * amount field; empty for null. Reads back through parseAmountToCents as the
 * same cents. The one way any field is pre-filled: there were copies written
 * with toLocaleString and toFixed on half a dozen screens.
 */
export function centsToInput(cents: number | null, _locale: string): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
}

/**
 * A rate — USD→AUD, or pesos per dollar — with `digits` places (4 by
 * default; 3 where it sits beside a match). `minDigits` lets a peso rate
 * drop the places it does not need: "1500", but "1500.5".
 */
export function formatRate(
  rate: number,
  _locale: string,
  digits = 4,
  minDigits = digits,
): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(rate);
}

/**
 * `max` exists for the peso fields on the Tarjetas screen: an ARS figure is
 * three orders of magnitude larger than an AUD one, so the ledger's ceiling
 * would refuse a perfectly ordinary bank fee. Every ledger caller leaves it
 * alone and keeps the limit the security rules enforce.
 */
export function parseAmountToCents(
  input: string,
  _locale: string,
  max: number = MAX_AMOUNT_CENTS,
): number | null {
  const raw = input.replace(/[^\d.,-]/g, "").trim();
  if (raw === "") return null;

  // The app's one format: a point for decimals. A comma is still read — as
  // grouping when it groups three digits, as a decimal otherwise — because
  // that is how amounts were typed until 2026-10-02.
  const decimalMark = ".";
  const groupMark = ",";
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
