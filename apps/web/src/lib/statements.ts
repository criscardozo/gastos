// Credit-card statements — the window a set of charges belongs to.
//
// A statement has two dates that mean different things and are easy to confuse:
//   - closingDate: the last day whose charges enter THIS statement.
//   - dueDate: the last day it can be paid. Always after the closing date.
//
// There is no "open"/"closed" flag. The open statement is simply the one with
// the greatest closingDate, so closing one and opening the next is a single
// create and two clients can never disagree about which is current.
//
// A charge stores no statement id: it belongs to the statement whose
// [startDate, closingDate] contains its date, exactly as an expense belongs to
// the period containing its date. Pure module — no Firebase, no React.

/** The two cards the household actually carries. */
export type CardBrand = "visa" | "mastercard";

export const CARD_BRANDS: readonly CardBrand[] = ["visa", "mastercard"] as const;

export interface StatementRange {
  startDate: string;
  closingDate: string;
  dueDate: string;
}

/** Whether a charge dated `date` enters this statement. */
export function containsCharge(
  statement: Pick<StatementRange, "startDate" | "closingDate">,
  date: string,
): boolean {
  return statement.startDate <= date && date <= statement.closingDate;
}

/**
 * The statement under way: the one with the greatest closingDate. Null when
 * none has been opened yet, which is what the empty state keys off.
 */
export function currentStatement<T extends StatementRange>(
  statements: readonly T[],
): T | null {
  if (statements.length === 0) return null;
  return statements.reduce((latest, s) =>
    s.closingDate > latest.closingDate ? s : latest,
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The same day of the month, `months` later, clamped to the target month's
 * length. Statements keep their day of the month ("cierra el 27"), so this is
 * how the next one is proposed.
 */
export function addMonthsKeepingDay(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = (((total % 12) + 12) % 12) + 1;
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear.toString().padStart(4, "0")}-${targetMonth
    .toString()
    .padStart(2, "0")}-${clamped.toString().padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const ms =
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    ) +
    days * 86_400_000;
  const d = new Date(ms);
  return `${d.getUTCFullYear().toString().padStart(4, "0")}-${(d.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`;
}

/**
 * What to prefill the "close and open the next" dialog with: both dates one
 * month on, keeping their day, and a window that starts the day after the
 * statement being closed — so no charge can fall between two statements.
 *
 * A proposal, not a decision: the user confirms or overrides both dates, which
 * is the point of asking at all (banks move these around).
 */
export function nextStatementProposal(previous: StatementRange): StatementRange {
  return {
    startDate: addDays(previous.closingDate, 1),
    closingDate: addMonthsKeepingDay(previous.closingDate, 1),
    dueDate: addMonthsKeepingDay(previous.dueDate, 1),
  };
}

/**
 * Whether `today` has already passed the statement's closing date.
 *
 * When it has, a charge made today does NOT belong to this statement: charges
 * are filed by their own date, so the screen would have to date it on the
 * closing day to keep it visible — filing a September purchase into August.
 * The honest answer is to close the statement and open the next one, which is
 * what the warning says.
 */
export function isPastClosing(
  today: string,
  statement: StatementRange | null,
): boolean {
  return statement !== null && today > statement.closingDate;
}

/** Total of a set of charges, in USD cents. */
export function statementTotalUsdCents(
  charges: readonly { usdCents: number }[],
): number {
  return charges.reduce((sum, charge) => sum + charge.usdCents, 0);
}

/** Per-card subtotals, for the breakdown under the statement total. */
export function totalsByCard(
  charges: readonly { card: string; usdCents: number }[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const charge of charges) {
    totals[charge.card] = (totals[charge.card] ?? 0) + charge.usdCents;
  }
  return totals;
}
