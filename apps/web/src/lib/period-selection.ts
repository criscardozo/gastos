// Which window the expense list is showing.
//
// Two kinds of window, and they are not the same kind of thing. A PERIOD is a
// materialized budget with its own amount; a MONTH is a calendar window that
// crosses period boundaries on purpose and has no budget at all. The screen
// lets you pick either, which is why the choice is one string rather than two
// pieces of state — two would allow a state where both are set and neither
// wins.
//
// Pulled out of the page it was written in so it can be tested: it was ~25
// lines of branching over a nullable string, a possibly-empty period list and
// a fallback, with no coverage at all, in a file of 981 lines.

import { monthRange, type PeriodRange } from "./periods";
import type { PeriodBudget } from "./firebase/converters";

/** `month:YYYY-MM` — the shape a calendar month takes in the selection. */
const MONTH_PREFIX = "month:";

export function monthSelection(startDate: string): string {
  return `${MONTH_PREFIX}${startDate.slice(0, 7)}`;
}

export interface Selection {
  /** The range to query, or null when there is nothing to show yet. */
  range: PeriodRange | null;
  /**
   * The period being shown, when the window IS a period. Null for a calendar
   * month — deliberately, because a month has no budget and anything drawing a
   * budget bar off it would be inventing one.
   */
  period: PeriodBudget | null;
  /** Whether the window is a calendar month rather than a period. */
  isMonth: boolean;
}

/**
 * Resolve the selection string into the window to show.
 *
 * `selection` null means "follow the current period", which is the default and
 * what nearly every visit wants. A selection naming a period that is no longer
 * in the loaded window (they are bounded to the most recent 26) falls back the
 * same way rather than showing nothing.
 */
export function resolveSelection(
  selection: string | null,
  periods: PeriodBudget[],
  currentPeriod: PeriodBudget | null,
): Selection {
  if (selection !== null && selection.startsWith(MONTH_PREFIX)) {
    return {
      range: monthRange(`${selection.slice(MONTH_PREFIX.length)}-01`),
      period: null,
      isMonth: true,
    };
  }
  // The newest period is the fallback when there is no current one: a household
  // whose latest period ended yesterday still has something to show.
  const fallback = currentPeriod ?? periods[periods.length - 1] ?? null;
  const chosen =
    selection === null
      ? fallback
      : (periods.find((p) => p.startDate === selection) ?? fallback);
  return { range: chosen, period: chosen, isMonth: false };
}
