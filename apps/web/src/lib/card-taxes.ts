// What the card statement adds on top of the purchases, in Argentine pesos.
//
// The purchases themselves are in USD (see cardCharges) but the bank bills the
// taxes in ARS, so this is the one place in the project that converts. The
// ledger never does — an expense in AUD is the only figure any budget reads,
// and that stays true. What lives here is an ESTIMATE of the peso side of a
// credit-card statement, shown so nobody is surprised by the bill.
//
// The three the bank applies, from Cristian's BBVA statement of 2026-08-29:
//
//   COMISION CUENTA FULL           40.413,22   a fixed monthly fee
//   DB IVA $ 21%                    8.486,78   21% of that fee
//   IIBB PERCEP-CABA 2,00%            975,31   ← base not modelled yet
//   IVA RG 4240 21%                10.240,84   ← base not modelled yet
//   DB.RG 5617 30%                241.402,75   30% of ALL foreign spend
//
// Only the last one is computed from the purchases. RG 4240 and IIBB apply to
// DIGITAL SERVICES from abroad rather than to every foreign purchase, so their
// base is a subset we cannot yet identify: on that statement it was 48.765,94,
// which matches neither the total spend nor the fee plus its IVA. Two
// hypotheses fit within 0.3% and one statement cannot separate them, so they
// are deliberately absent rather than guessed — a plausible wrong number here
// would look exactly like a right one.
//
// These are ESTIMATES to the cent, not reproductions. Against the statement
// above the total lands within one cent, because the bank appears to compute
// each percepción per purchase and sum them rather than take a percentage of
// the total — on that one statement DB IVA rounds up (8.486,7762 → 8.486,78)
// while IIBB truncates (975,3188 → 975,31). Matching that exactly would mean
// inventing a rounding rule from a single sample.
//
// Pure module: no Firebase, no React, no network. The rate comes in as an
// argument precisely so this can be tested without one.

import { formatArs } from "./money";

/** Percentages as the statement prints them. */
export const IVA_RATE = 0.21;
export const RG_5617_RATE = 0.3;

export interface CardFees {
  /** The monthly account fee, in ARS cents. Fixed, so it is configured once. */
  commissionArsCents: number;
}

export interface TaxLine {
  /** Matches the wording on the statement, so the two can be compared. */
  label: string;
  arsCents: number;
  /** What it was computed from, for the "why is this number" question. */
  basis: string;
}

/** ARS cents for `usdCents` at `rate` pesos per dollar. */
export function usdToArsCents(usdCents: number, rate: number): number {
  return Math.round((usdCents / 100) * rate * 100);
}

/**
 * The peso charges this statement will carry.
 *
 * `usdCents` is the statement's total foreign spend; `rate` the pesos per
 * dollar to value it at. Returns an empty list when there is no fee configured
 * AND nothing was spent, so a fresh statement shows nothing rather than three
 * zeroes.
 */
export function taxLines(
  usdCents: number,
  rate: number,
  fees: CardFees,
): TaxLine[] {
  const lines: TaxLine[] = [];

  if (fees.commissionArsCents > 0) {
    lines.push({
      label: "Comisión Cuenta Full",
      arsCents: fees.commissionArsCents,
      basis: "fija",
    });
    lines.push({
      label: "DB IVA 21%",
      arsCents: Math.round(fees.commissionArsCents * IVA_RATE),
      basis: "21% de la comisión",
    });
  }

  if (usdCents > 0) {
    const spendArsCents = usdToArsCents(usdCents, rate);
    lines.push({
      label: "DB.RG 5617 30%",
      arsCents: Math.round(spendArsCents * RG_5617_RATE),
      basis: `30% de ${formatArs(spendArsCents)}`,
    });
  }

  return lines;
}

/** Everything above, added up. */
export function totalArsCents(lines: readonly TaxLine[]): number {
  return lines.reduce((sum, line) => sum + line.arsCents, 0);
}
