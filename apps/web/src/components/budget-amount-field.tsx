"use client";

// Amount parsing for the budget editors.
//
// This module used to carry an AUD|USD toggle and convert USD input to AUD at
// entry time. That is gone: AUD is the only currency anyone types. The USD
// figure on an expense is no longer a conversion — it is what the bank
// actually charged, and it arrives from the bank's notification email.

import { parseAmountToCents } from "@/lib/money";

/** Typed amount → AUD integer cents, or null when it isn't a positive amount. */
export function parseBudgetAmount(input: string): number | null {
  return parseAmountToCents(input);
}
