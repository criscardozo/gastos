import type { Expense } from "./firebase/converters";

/**
 * What the expenses screen actually shows: the rows that survive the filters,
 * in the order they are read, grouped into the days they are printed under.
 *
 * Pulled out of gastos/page.tsx because it is the one part of that screen with
 * an answer that can be wrong — the filters compose, the sort has a tiebreak
 * that matters, and the grouping depends on the sort having run. Inline in a
 * component none of it could be tested; the screen only ever showed you the
 * result and you had to believe it.
 */

export type VerificationFilter = "all" | "verified" | "unverified";

export interface ListFilters {
  /** A category id, or "all". */
  category: string;
  /** A member uid, or "all". */
  person: string;
  verification: VerificationFilter;
  /** Free text, matched against the note. Trimmed and folded here. */
  search: string;
}

export interface DayGroup {
  date: string;
  rows: Expense[];
  totalCents: number;
}

export const NO_FILTERS: ListFilters = {
  category: "all",
  person: "all",
  verification: "all",
  search: "",
};

/** Newest first, and within a day the most recently CREATED first. */
function byDateThenCreated(a: Expense, b: Expense): number {
  const at = a.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
  const bt = b.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER;
  // A pending write has no server timestamp yet. It sorts FIRST, not last:
  // the row you just typed belongs at the top of its day, where you are
  // looking, rather than buried under the ones that already landed.
  return b.date.localeCompare(a.date) || bt - at;
}

export function filterExpenses(
  expenses: readonly Expense[],
  filters: ListFilters,
): Expense[] {
  const query = filters.search.trim().toLowerCase();
  return expenses.filter(
    (e) =>
      (filters.category === "all" || e.categoryId === filters.category) &&
      (filters.person === "all" || e.createdBy === filters.person) &&
      (filters.verification === "all" ||
        (filters.verification === "verified" ? e.verified : !e.verified)) &&
      (query === "" || e.note.toLowerCase().includes(query)),
  );
}

export function sortExpenses(expenses: readonly Expense[]): Expense[] {
  return [...expenses].sort(byDateThenCreated);
}

/**
 * Consecutive runs of the same date, with their total.
 *
 * Assumes the input is sorted, which is why it is not exported on its own —
 * `visibleExpenses` is the only caller and it sorts first. Fed an unsorted
 * list it would print the same day twice, which is exactly the bug a reader
 * would blame on the data.
 */
function groupByDay(sorted: readonly Expense[]): DayGroup[] {
  const days: DayGroup[] = [];
  for (const e of sorted) {
    const last = days[days.length - 1];
    if (last !== undefined && last.date === e.date) {
      last.rows.push(e);
      last.totalCents += e.amountCents;
    } else {
      days.push({ date: e.date, rows: [e], totalCents: e.amountCents });
    }
  }
  return days;
}

/** The three steps in the order the screen needs them. */
export function visibleExpenses(
  expenses: readonly Expense[],
  filters: ListFilters,
): { rows: Expense[]; days: DayGroup[] } {
  const rows = sortExpenses(filterExpenses(expenses, filters));
  return { rows, days: groupByDay(rows) };
}
