// Everything the Estadísticas page computes, as pure functions over a list of
// expenses. No Firestore, no React: the page loads a date-bounded range once
// and hands it here, which keeps the maths testable and the reads honest.
//
// Money stays integer cents throughout; only the formatters divide.

import { addDays, daysBetween } from "./periods";

export interface StatExpense {
  id: string;
  amountCents: number;
  categoryId: string;
  note: string;
  date: string;
  createdBy: string;
  usdCents: number | null;
  verified: boolean;
}

export interface Totals {
  totalCents: number;
  count: number;
  /** Mean expense, 0 when there are none. */
  averageCents: number;
  /** Total divided by the days in the range (not by the days with spending). */
  perDayCents: number;
  /** The single largest expense, null when the range is empty. */
  biggest: StatExpense | null;
  /** Days in the range with no expense at all. */
  daysWithoutSpending: number;
}

export function totals(
  expenses: readonly StatExpense[],
  range: { startDate: string; endDate: string },
): Totals {
  const totalCents = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const days = Math.max(daysBetween(range.startDate, range.endDate) + 1, 1);
  const withSpending = new Set(expenses.map((e) => e.date)).size;
  return {
    totalCents,
    count: expenses.length,
    averageCents:
      expenses.length === 0 ? 0 : Math.round(totalCents / expenses.length),
    perDayCents: Math.round(totalCents / days),
    biggest:
      expenses.length === 0
        ? null
        : expenses.reduce((max, e) => (e.amountCents > max.amountCents ? e : max)),
    daysWithoutSpending: Math.max(days - withSpending, 0),
  };
}

export interface CategorySlice {
  categoryId: string;
  totalCents: number;
  count: number;
  /** 0..1 of the range's total. */
  share: number;
}

/** Spend per category, biggest first. */
export function byCategory(expenses: readonly StatExpense[]): CategorySlice[] {
  const map = new Map<string, { totalCents: number; count: number }>();
  for (const e of expenses) {
    const prev = map.get(e.categoryId) ?? { totalCents: 0, count: 0 };
    map.set(e.categoryId, {
      totalCents: prev.totalCents + e.amountCents,
      count: prev.count + 1,
    });
  }
  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  return [...map.entries()]
    .map(([categoryId, v]) => ({
      categoryId,
      totalCents: v.totalCents,
      count: v.count,
      share: total === 0 ? 0 : v.totalCents / total,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export interface DayPoint {
  date: string;
  totalCents: number;
}

/**
 * One entry per calendar day in the range, zeros included — a chart with gaps
 * for the quiet days would misread as "no data" rather than "spent nothing".
 */
export function byDay(
  expenses: readonly StatExpense[],
  range: { startDate: string; endDate: string },
): DayPoint[] {
  const sums = new Map<string, number>();
  for (const e of expenses) {
    sums.set(e.date, (sums.get(e.date) ?? 0) + e.amountCents);
  }
  const out: DayPoint[] = [];
  const days = Math.max(daysBetween(range.startDate, range.endDate), 0);
  for (let i = 0; i <= days; i += 1) {
    const date = addDays(range.startDate, i);
    out.push({ date, totalCents: sums.get(date) ?? 0 });
  }
  return out;
}

/** Running total across the range — the "how fast are we going" line. */
export function cumulative(days: readonly DayPoint[]): DayPoint[] {
  let running = 0;
  return days.map((d) => {
    running += d.totalCents;
    return { date: d.date, totalCents: running };
  });
}

export interface WeekdayAverage {
  /** 0 = Monday … 6 = Sunday, the week as this household reads it. */
  weekday: number;
  totalCents: number;
  /** Mean over the number of THAT weekday in the range, not over 7. */
  averageCents: number;
}

/** Monday-first weekday index for a "YYYY-MM-DD" calendar date. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Spend by day of the week, averaged over how many of each weekday the range
 * actually contains — otherwise a range of 10 days would make Mondays look
 * cheap simply because there was only one.
 */
export function byWeekday(
  expenses: readonly StatExpense[],
  range: { startDate: string; endDate: string },
): WeekdayAverage[] {
  const totals = new Array<number>(7).fill(0);
  const occurrences = new Array<number>(7).fill(0);
  for (const day of byDay([], range)) {
    occurrences[weekdayIndex(day.date)] += 1;
  }
  for (const e of expenses) totals[weekdayIndex(e.date)] += e.amountCents;
  return totals.map((totalCents, weekday) => ({
    weekday,
    totalCents,
    averageCents:
      occurrences[weekday] === 0
        ? 0
        : Math.round(totalCents / occurrences[weekday]),
  }));
}

export interface MemberSlice {
  uid: string;
  totalCents: number;
  count: number;
  share: number;
}

/** Who entered what. Attribution, not who paid — one card pays for everything. */
export function byMember(expenses: readonly StatExpense[]): MemberSlice[] {
  const map = new Map<string, { totalCents: number; count: number }>();
  for (const e of expenses) {
    const prev = map.get(e.createdBy) ?? { totalCents: 0, count: 0 };
    map.set(e.createdBy, {
      totalCents: prev.totalCents + e.amountCents,
      count: prev.count + 1,
    });
  }
  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  return [...map.entries()]
    .map(([uid, v]) => ({
      uid,
      totalCents: v.totalCents,
      count: v.count,
      share: total === 0 ? 0 : v.totalCents / total,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export interface VerificationSummary {
  verified: number;
  unverified: number;
  /** USD the bank has actually charged across the verified ones. */
  usdCents: number;
  /** AUD covered by those verified expenses — the base of the rate below. */
  verifiedAudCents: number;
  /** Median usd/aud over the verified pairs; null until there is one. */
  rate: number | null;
}

export function verification(
  expenses: readonly StatExpense[],
): VerificationSummary {
  const verified = expenses.filter((e) => e.verified && e.usdCents !== null);
  const rates = verified
    .filter((e) => e.amountCents > 0)
    .map((e) => (e.usdCents as number) / e.amountCents)
    .sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  return {
    verified: verified.length,
    unverified: expenses.length - verified.length,
    usdCents: verified.reduce((sum, e) => sum + (e.usdCents ?? 0), 0),
    verifiedAudCents: verified.reduce((sum, e) => sum + e.amountCents, 0),
    rate:
      rates.length === 0
        ? null
        : rates.length % 2 === 1
          ? rates[mid]
          : (rates[mid - 1] + rates[mid]) / 2,
  };
}

/** The `limit` largest expenses, biggest first. */
export function biggest(
  expenses: readonly StatExpense[],
  limit = 5,
): StatExpense[] {
  return [...expenses]
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, limit);
}

/**
 * Straight-line budget pace: what a period's budget allows by each day if it
 * were spent evenly. The comparison line for the cumulative chart — above it
 * means going faster than the envelope allows.
 */
export function pace(budgetCents: number, dayCount: number): number[] {
  if (dayCount <= 0) return [];
  return Array.from({ length: dayCount }, (_, i) =>
    Math.round((budgetCents * (i + 1)) / dayCount),
  );
}
