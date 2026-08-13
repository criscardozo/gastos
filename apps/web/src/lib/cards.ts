// Which card a bank charge came from, and therefore which screen it belongs to.
//
// The bank names the card exactly one way — "finalizada en 2024" — and the
// ingestion already stores those four digits on every charge. Told which digits
// are the debit card and which the credit one, the app can route: a debit charge
// is a household expense waiting for its USD figure, a credit charge is a line
// on a card statement.
//
// Pure module: no Firebase, no React.

import type { CardBrand } from "./statements";

export type CardKind = "debit" | "credit";

export interface HouseholdCard {
  kind: CardKind;
  /** Only meaningful for credit: the Tarjetas screen needs a brand and the
   * bank's email never states one. */
  brand?: CardBrand | null;
}

/** `households/{id}.cards` — keyed by the card's last four digits. */
export type HouseholdCards = Record<string, HouseholdCard>;

export const MAX_CARDS = 6;

/**
 * Where a charge belongs. `unknown` covers both "no digits in the email" and
 * "digits we were never told about" — deliberately one bucket, because the
 * app's answer to both is the same: show it in both places rather than pick a
 * screen and risk hiding it.
 */
export type ChargeRouting = "debit" | "credit" | "unknown";

export function classifyCharge(
  cardLast4: string | null | undefined,
  cards: HouseholdCards | null | undefined,
): ChargeRouting {
  if (cardLast4 === null || cardLast4 === undefined || cardLast4 === "") {
    return "unknown";
  }
  const card = cards?.[cardLast4];
  if (card === undefined) return "unknown";
  return card.kind;
}

/** Charges the expense-verification screens should offer: debit, plus anything
 * unidentified — losing a charge is worse than showing it twice. */
export function belongsToExpenses(
  cardLast4: string | null | undefined,
  cards: HouseholdCards | null | undefined,
): boolean {
  return classifyCharge(cardLast4, cards) !== "credit";
}

/** Charges the Tarjetas screen should offer: credit, plus anything unidentified. */
export function belongsToCard(
  cardLast4: string | null | undefined,
  cards: HouseholdCards | null | undefined,
): boolean {
  return classifyCharge(cardLast4, cards) !== "debit";
}

/**
 * The brand to prefill when turning a charge into a card charge: the configured
 * one, or null when the card is unidentified (or was saved without a brand), in
 * which case the user picks.
 */
export function brandFor(
  cardLast4: string | null | undefined,
  cards: HouseholdCards | null | undefined,
): CardBrand | null {
  if (cardLast4 === null || cardLast4 === undefined) return null;
  return cards?.[cardLast4]?.brand ?? null;
}

/** Four digits, nothing else — what the bank prints and what keys the map. */
export function isValidLast4(value: string): boolean {
  return /^\d{4}$/.test(value);
}

/** Rows for the editor, in a stable order (by digits) so nothing jumps. */
export function cardRows(
  cards: HouseholdCards | null | undefined,
): { last4: string; card: HouseholdCard }[] {
  return Object.entries(cards ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([last4, card]) => ({ last4, card }));
}
