/**
 * The ceilings the security rules enforce, mirrored so a screen can refuse what
 * the server would refuse.
 *
 * The rules stay the only boundary — these numbers are not the check, they are
 * the check the USER gets to see. Firestore's local cache shows a refused write
 * as saved, so a value the form accepted and the rules did not reads as an
 * expense that landed and then an error alert about it.
 *
 * `MAX_AMOUNT_CENTS` lives in money.ts for the same reason and says so; this
 * module holds the ones with no topical home. What ties all of them together is
 * `limits.test.ts`, which reads `firestore.rules` and the Swift sources rather
 * than trusting the copies to stay equal.
 */

/** `expenses`: note.size() <= 200. */
export const MAX_NOTE_CHARACTERS = 200;

/**
 * `households`: name.size() <= 60.
 *
 * Capped in Ajustes since forever and not in onboarding — the same field, two
 * forms, one client. Harder to spot than a cross-platform gap because neither
 * file mentions the other. (The Stock session hit the identical pair.)
 */
export const MAX_HOUSEHOLD_NAME_CHARACTERS = 60;

/** `defaultBudget` and `periodBudgets`: amountCents <= 100_000_000. */
export const MAX_BUDGET_AMOUNT_CENTS = 100_000_000;
