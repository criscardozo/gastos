import { addDays, monthRange, type PeriodRange } from "./periods";

// The cycle Datos shows: the days since the household last did the accounts
// ("Hacemos las cuentas"). Not the calendar month and not the budget period —
// the stretch the next reckoning will have to account for (Cristian,
// 28/10/2026). The reckoning day itself belongs to the cycle it CLOSED.

/** What a cycle preset resolves to. Not a bare range: two of the outcomes are
 * "there is nothing to read", and each says something different on screen. */
export type CycleResult =
  | { kind: "range"; range: PeriodRange }
  /** The accounts were done today, so the new cycle has no days yet. */
  | { kind: "startsTomorrow" }
  /** Fewer than two reckonings: the last cycle has no first day to start on. */
  | { kind: "noPrevious" };

/**
 * From the day after the last reckoning to today.
 *
 * `reckonings` are dates newest first, as `fetchReckonings` returns them. With
 * none yet there is no start to count from, so it falls back to the 1st of the
 * month — bounded, like every read here, and what Datos showed before.
 */
export function currentCycle(
  reckonings: readonly string[],
  today: string,
): CycleResult {
  const last = reckonings[0];
  if (last === undefined) {
    return {
      kind: "range",
      range: { startDate: monthRange(today).startDate, endDate: today },
    };
  }
  if (last >= today) return { kind: "startsTomorrow" };
  return { kind: "range", range: { startDate: addDays(last, 1), endDate: today } };
}

/** The cycle the last reckoning closed: the day after the one before it, to
 * the last reckoning itself. */
export function previousCycle(reckonings: readonly string[]): CycleResult {
  const [last, before] = reckonings;
  if (last === undefined || before === undefined) return { kind: "noPrevious" };
  return { kind: "range", range: { startDate: addDays(before, 1), endDate: last } };
}
