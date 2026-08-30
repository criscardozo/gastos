// What the card statement adds on top of the purchases, in Argentine pesos.
//
// The purchases themselves are in USD (see cardCharges) but the bank bills the
// taxes in ARS, so this is the one place in the project that converts. The
// ledger never does — an expense in AUD is the only figure any budget reads,
// and that stays true. What lives here is an ESTIMATE of the peso side of a
// credit-card statement, shown so nobody is surprised by the bill.
//
// The five lines, from Cristian's BBVA statement of 2026-08-29:
//
//   COMISION CUENTA FULL              40.413,22   a fixed monthly fee
//   DB IVA $ 21%                       8.486,78   21% of that fee
//   IIBB PERCEP-CABA 2,00%(48765,94)     975,31   2%  of the DIGITAL spend
//   IVA RG 4240 21%(48765,94)         10.240,84   21% of the DIGITAL spend
//   DB.RG 5617 30%(804675,86)        241.402,75   30% of ALL foreign spend
//                                    ──────────
//                                    301.518,90   = the statement's SALDO ACTUAL
//
// TWO DIFFERENT BASES, and the statement prints both. 804.675,86 is the whole
// month's spend (US$ 531,49 at 1514,00); 48.765,94 is US$ 32,21 at the same
// rate, which is exactly the two DiDiMobility charges — 17,18 + 15,03. The Uber
// ride, the Temu order and the Kmart purchase were NOT in it. RG 4240 and IIBB
// tax digital services from abroad, not every foreign purchase, and the bank
// decides which is which from how the merchant is registered.
//
// So the app cannot derive it: it has to be told, per charge, which is what
// `cardCharges.digital` is for. It defaults to true, because nearly everything
// Cristian puts on this card is a digital service — but a Kmart run is not, and
// taxing it 23% would overstate the bill by more than the purchase.
//
// ROUNDING. The percepciones TRUNCATE and the IVA on the fee ROUNDS. Not a
// guess: on the statement above, all three percepciones truncate (975,3188 →
// 975,31; 10.240,8474 → 10.240,84; 241.402,758 → 241.402,75) while the fee's
// IVA rounds up (8.486,7762 → 8.486,78). Applying that reproduces every line
// and the total to the cent. Three data points for one rule and one for the
// other; if a future statement disagrees, this comment is where to start.
//
// Pure module: no Firebase, no React, no network. The rate comes in as an
// argument precisely so this can be tested without one.

import { formatArs } from "./money";

/** Percentages as the statement prints them. */
export const IVA_RATE = 0.21;
export const IIBB_RATE = 0.02;
export const RG_4240_RATE = 0.21;
export const RG_5617_RATE = 0.3;

export interface CardFees {
  /** The monthly account fee, in ARS cents. Fixed, so it is configured once. */
  commissionArsCents: number;
}

export interface StatementSpend {
  /** Everything the card billed this statement, in USD cents. */
  usdCents: number;
  /** The part of it the bank treats as digital services. A subset. */
  digitalUsdCents: number;
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

/** A percepción, truncated to the cent — see the rounding note above. */
function percepcion(baseArsCents: number, rate: number): number {
  return Math.floor(baseArsCents * rate);
}

/**
 * The peso charges this statement will carry, in the statement's own order.
 *
 * `rate` is the pesos per dollar to value the spend at. Returns an empty list
 * when there is no fee configured AND nothing was spent, so a fresh statement
 * shows nothing rather than five zeroes.
 */
export function taxLines(
  spend: StatementSpend,
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
      basis: `21% de ${formatArs(fees.commissionArsCents)}`,
    });
  }

  // The digital subset, taxed twice over — and only when there IS one. A month
  // of nothing but a Kmart run carries neither line, exactly as the bank does.
  if (spend.digitalUsdCents > 0) {
    const digitalArsCents = usdToArsCents(spend.digitalUsdCents, rate);
    lines.push({
      label: "IIBB PERCEP-CABA 2%",
      arsCents: percepcion(digitalArsCents, IIBB_RATE),
      basis: `2% de ${formatArs(digitalArsCents)}`,
    });
    lines.push({
      label: "IVA RG 4240 21%",
      arsCents: percepcion(digitalArsCents, RG_4240_RATE),
      basis: `21% de ${formatArs(digitalArsCents)}`,
    });
  }

  if (spend.usdCents > 0) {
    const spendArsCents = usdToArsCents(spend.usdCents, rate);
    lines.push({
      label: "DB.RG 5617 30%",
      arsCents: percepcion(spendArsCents, RG_5617_RATE),
      basis: `30% de ${formatArs(spendArsCents)}`,
    });
  }

  return lines;
}

/** Everything above, added up. */
export function totalArsCents(lines: readonly TaxLine[]): number {
  return lines.reduce((sum, line) => sum + line.arsCents, 0);
}
