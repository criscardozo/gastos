// Pure calendar-date period logic. No Firebase imports — this module is the
// TS twin of the Swift implementation and both must pass every vector in
// shared/period-test-vectors.json.
//
// All dates are zero-padded "YYYY-MM-DD" calendar-date strings, which makes
// range comparisons plain lexicographic string comparisons.

export type PeriodType = "weekly" | "fortnightly";

export type BudgetState = "comfortable" | "warning" | "over";

export interface PeriodRange {
  startDate: string;
  endDate: string;
}

/** Warning threshold for the budget progress state (spent / budget). */
export const BUDGET_WARNING_THRESHOLD = 0.85;

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear().toString().padStart(4, "0");
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Add (or subtract, when negative) calendar days to a date string. */
export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Signed number of calendar days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** Number of days a period type spans. */
export function periodLengthDays(period: PeriodType): number {
  return period === "weekly" ? 7 : 14;
}

/** Inclusive end date: startDate + (7 | 14) − 1 days. */
export function periodEndDate(startDate: string, period: PeriodType): string {
  return addDays(startDate, periodLengthDays(period) - 1);
}

/** Whether `date` falls inside the inclusive [startDate, endDate] range. */
/**
 * The calendar month `date` falls in, as a range.
 *
 * Calendar months are NOT budget periods — a period is a materialized doc with
 * its own budget, and a month is just a window to look through. Both the Gastos
 * list and the stats screen offer one, so the arithmetic lives here with the
 * rest of it rather than being written twice.
 */
export function monthRange(date: string): PeriodRange {
  const [year, month] = date.split("-");
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${String(last).padStart(2, "0")}`,
  };
}

/** `count` calendar months ending with the one `date` falls in, newest first. */
export function recentMonths(date: string, count: number): PeriodRange[] {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return Array.from({ length: count }, (_, i) => {
    // Date.UTC normalizes a month of 0 or -1 into the previous year by itself,
    // which is why this counts backwards through it instead of by hand.
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    return monthRange(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`,
    );
  });
}

/** The `months` calendar months ending with the one `date` falls in. */
export function monthsBackRange(date: string, months: number): PeriodRange {
  const all = recentMonths(date, months);
  return {
    startDate: all[all.length - 1].startDate,
    endDate: all[0].endDate,
  };
}

export function containsDate(range: PeriodRange, date: string): boolean {
  return range.startDate <= date && date <= range.endDate;
}

/**
 * Local calendar date for an instant in a given IANA timezone.
 * This is THE bucketing primitive: an expense logged at 23:30 Sydney time
 * must land on the Sydney date, never the UTC one.
 */
export function todayInTimezone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Ordered list of periods that must be materialized so that `today` is
 * covered, chaining from the last materialized period (or seeding from
 * `anchorDate` when none exists yet). Empty when today is already covered
 * or precedes the anchor.
 */
export function cascadeMaterialization(
  last: PeriodRange | null,
  anchorDate: string | null,
  defaultPeriod: PeriodType,
  today: string,
): PeriodRange[] {
  let nextStart: string;
  if (last === null) {
    if (anchorDate === null || anchorDate > today) return [];
    nextStart = anchorDate;
  } else {
    if (today <= last.endDate) return [];
    nextStart = addDays(last.endDate, 1);
  }

  const created: PeriodRange[] = [];
  let start = nextStart;
  // Each new period takes the CURRENT default period length; loop until the
  // chain covers today.
  for (;;) {
    const end = periodEndDate(start, defaultPeriod);
    created.push({ startDate: start, endDate: end });
    if (today <= end) break;
    start = addDays(end, 1);
  }
  return created;
}

/** The parts of a materialized period the extension maths needs. */
export interface PeriodBudgetLike {
  startDate: string;
  endDate: string;
  period: PeriodType;
  amountCents: number;
}

export interface PeriodExtension {
  /** Where the period now ends, inclusive. */
  endDate: string;
  /** How many days it gained — always 7, but stated rather than assumed. */
  addedDays: number;
}

/**
 * Turn the week under way into two weeks, without moving where it started.
 *
 * The household budgets by the week (Friday to Thursday), and sometimes a few
 * days in it becomes clear that this one has to stretch. The new end date is
 * exactly the one a fortnightly period beginning that same day would have had,
 * which is what keeps the NEXT period landing on the household's usual weekday:
 * a week running Fri 7 → Thu 13 becomes Fri 7 → Thu 20, and the next one still
 * opens on a Friday.
 *
 * Returns null for a period that is already a fortnight — there is nothing left
 * to extend into, and this is deliberately one-way. Expenses need no migration:
 * one belongs to whichever period's range contains its date, so moving the
 * boundary IS the whole operation.
 */
export function extendToFortnight(period: {
  startDate: string;
  endDate: string;
  period: PeriodType;
}): PeriodExtension | null {
  if (period.period !== "weekly") return null;
  const endDate = periodEndDate(period.startDate, "fortnightly");
  return { endDate, addedDays: daysBetween(period.endDate, endDate) };
}

/** The most a period may be stretched to, counted from its own start. */
export const MAX_STRETCHED_DAYS = 31;

/**
 * Move the last period's end date out to `toEndDate`, keeping its budget.
 *
 * What it is for: changing which weekday the budget starts on, without losing
 * what is left of the week under way. Stretching the week that just ended
 * through Sunday means its leftover is still spendable on Friday and Saturday,
 * and the next period starts on Monday — because materialization always chains
 * from the last period's end date plus one.
 *
 * The AMOUNT does not move. Stretching buys days, not money: the point is to
 * spend what is already there over a slightly longer stretch. A period whose
 * budget grew with its length would be a different feature.
 *
 * Returns null when the request makes no sense, and each refusal is a rule
 * worth stating:
 *   - not later than the current end — that is a shrink, and shrinking would
 *     orphan any expense already logged in the days it gave up;
 *   - earlier than today — a period cannot end before the day you are asking
 *     the question on;
 *   - longer than MAX_STRETCHED_DAYS from its start — at some point this is
 *     not a stretched week, it is a typo in a date field.
 */
export function stretchPeriodTo(
  period: { startDate: string; endDate: string },
  toEndDate: string,
  today: string,
): PeriodExtension | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toEndDate)) return null;
  if (toEndDate <= period.endDate) return null;
  if (toEndDate < today) return null;
  if (daysBetween(period.startDate, toEndDate) + 1 > MAX_STRETCHED_DAYS) {
    return null;
  }
  return {
    endDate: toEndDate,
    addedDays: daysBetween(period.endDate, toEndDate),
  };
}

/**
 * What is left to spend per day until the period ends, today included.
 *
 * Integer cents, rounded DOWN: a figure you can keep to every day without
 * overshooting by the last one. Zero once the budget is gone rather than a
 * negative daily figure, which nobody can act on — the hero already says by
 * how much it is over. Null when `today` is past `endDate`.
 */
export function dailyAllowance(
  remainingCents: number,
  today: string,
  endDate: string,
): number | null {
  const days = daysBetween(today, endDate) + 1;
  if (days <= 0) return null;
  if (remainingCents <= 0) return 0;
  return Math.floor(remainingCents / days);
}

/**
 * Budget progress state. `over` when spent exceeds the budget, `warning`
 * from 85% of the budget (inclusive), `comfortable` otherwise.
 * Integer-only math — no float division edge cases at the exact threshold.
 */
export function budgetState(
  spentCents: number,
  budgetCents: number,
): BudgetState {
  if (spentCents > budgetCents) return "over";
  if (spentCents * 100 >= budgetCents * 85) return "warning";
  return "comfortable";
}
