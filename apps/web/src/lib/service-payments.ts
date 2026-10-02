// Last month's Servicios payments: the table at the bottom of /servicios,
// for "how much did the services cost us, exactly". Cases in
// shared/service-payments-vectors.json, so an iOS version runs the same ones.

import { addDays, monthRange, type PeriodRange } from "./periods";
import { SERVICES_CATEGORY_ID } from "./services";

/** The calendar month before the one `today` falls in. */
export function previousMonth(today: string): PeriodRange {
  return monthRange(addDays(`${today.slice(0, 7)}-01`, -1));
}

export interface PaymentLike {
  id: string;
  amountCents: number;
  categoryId: string;
  note: string;
  date: string;
  usdCents?: number | null;
}

/**
 * Every Servicios expense in `expenses` (already bounded to the month), by
 * date then id, and their totals. Every one — not only those whose note names
 * a service on the register — because the question is what was paid, and an
 * expense noted the way the bill reads is still a payment.
 *
 * The USD total is the bank's figure for the verified rows only, so
 * `unverified` says how many it leaves out.
 */
export function servicePayments<T extends PaymentLike>(
  expenses: readonly T[],
): { rows: T[]; totalAudCents: number; totalUsdCents: number; unverified: number } {
  const rows = expenses
    .filter((e) => e.categoryId === SERVICES_CATEGORY_ID)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
  let totalAudCents = 0;
  let totalUsdCents = 0;
  let unverified = 0;
  for (const row of rows) {
    totalAudCents += row.amountCents;
    if (row.usdCents === null || row.usdCents === undefined) unverified += 1;
    else totalUsdCents += row.usdCents;
  }
  return { rows, totalAudCents, totalUsdCents, unverified };
}
