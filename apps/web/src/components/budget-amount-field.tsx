"use client";

// Amount parsing for the budget editors.
//
// This module used to carry an AUD|USD toggle and convert USD input to AUD at
// entry time. That is gone: AUD is the only currency anyone types. The USD
// figure on an expense is no longer a conversion — it is what the bank
// actually charged, and it arrives from the bank's notification email.

import { parseAmountToCents } from "@/lib/money";

/**
 * Typed amount → AUD integer cents, or null when it isn't a positive amount.
 *
 * The locale is required, not optional: "1.050" is a thousand and fifty in
 * Spanish and one point oh five in English, and guessing got it wrong by a
 * factor of a thousand. See parseAmountToCents.
 */
export function parseBudgetAmount(input: string, locale: string): number | null {
  return parseAmountToCents(input, locale);
}
