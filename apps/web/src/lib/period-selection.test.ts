import { describe, expect, it } from "vitest";

import { monthSelection, resolveSelection } from "./period-selection";
import type { PeriodBudget } from "./firebase/converters";

const period = (startDate: string, endDate: string): PeriodBudget => ({
  startDate,
  endDate,
  period: "weekly",
  amountCents: 18386,
  source: "custom",
  rolloverCents: 0,
  confirmed: true,
});

const periods = [
  period("2026-08-21", "2026-09-03"),
  period("2026-09-04", "2026-09-17"),
];

describe("resolveSelection", () => {
  it("follows the current period when nothing is selected", () => {
    const chosen = resolveSelection(null, periods, periods[1]);
    expect(chosen.range).toEqual(periods[1]);
    expect(chosen.period).toEqual(periods[1]);
    expect(chosen.isMonth).toBe(false);
  });

  it("falls back to the newest period when there is no current one", () => {
    // A household whose last period ended yesterday still has something to
    // show; the alternative is a blank screen for a day.
    expect(resolveSelection(null, periods, null).range).toEqual(periods[1]);
  });

  it("shows the period that was picked", () => {
    expect(resolveSelection("2026-08-21", periods, periods[1]).range).toEqual(
      periods[0],
    );
  });

  it("falls back when the picked period is no longer loaded", () => {
    // The listener keeps the most recent 26, so a link or a stale selection can
    // name one that has dropped out. Falling back beats showing nothing.
    const chosen = resolveSelection("2020-01-01", periods, periods[1]);
    expect(chosen.range).toEqual(periods[1]);
  });

  it("resolves a month to a calendar range with NO period attached", () => {
    // The distinction that matters: a month crosses period boundaries and has
    // no budget, so anything drawing a budget bar off it would be inventing
    // one. Hence period is null even though a range exists.
    const chosen = resolveSelection("month:2026-09", periods, periods[1]);
    expect(chosen.range).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(chosen.period).toBeNull();
    expect(chosen.isMonth).toBe(true);
  });

  it("gets February right, including a leap year", () => {
    expect(resolveSelection("month:2028-02", periods, null).range).toEqual({
      startDate: "2028-02-01",
      endDate: "2028-02-29",
    });
    expect(resolveSelection("month:2026-02", periods, null).range).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });

  it("has nothing to show for a household with no periods at all", () => {
    const chosen = resolveSelection(null, [], null);
    expect(chosen.range).toBeNull();
    expect(chosen.period).toBeNull();
  });

  it("round-trips a month through monthSelection", () => {
    const chosen = resolveSelection(monthSelection("2026-09-04"), periods, null);
    expect(chosen.range).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
  });
});
