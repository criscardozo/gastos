import { describe, expect, it } from "vitest";

import { currentCycle, previousCycle } from "./reckoning-cycle";

describe("currentCycle", () => {
  it("runs from the day after the last reckoning to today", () => {
    expect(currentCycle(["2026-10-15", "2026-09-30"], "2026-10-28")).toEqual({
      kind: "range",
      range: { startDate: "2026-10-16", endDate: "2026-10-28" },
    });
  });

  it("crosses a month boundary rather than stopping at the 1st", () => {
    expect(currentCycle(["2026-09-25"], "2026-10-03")).toEqual({
      kind: "range",
      range: { startDate: "2026-09-26", endDate: "2026-10-03" },
    });
  });

  it("has no days yet on the day the accounts were done", () => {
    expect(currentCycle(["2026-10-28", "2026-10-15"], "2026-10-28")).toEqual({
      kind: "startsTomorrow",
    });
  });

  it("falls back to the month so far before the first reckoning", () => {
    expect(currentCycle([], "2026-10-28")).toEqual({
      kind: "range",
      range: { startDate: "2026-10-01", endDate: "2026-10-28" },
    });
  });
});

describe("previousCycle", () => {
  it("is the stretch the last reckoning closed, that day included", () => {
    expect(previousCycle(["2026-10-15", "2026-09-30", "2026-09-01"])).toEqual({
      kind: "range",
      range: { startDate: "2026-10-01", endDate: "2026-10-15" },
    });
  });

  it("does not exist with fewer than two reckonings", () => {
    expect(previousCycle(["2026-10-15"])).toEqual({ kind: "noPrevious" });
    expect(previousCycle([])).toEqual({ kind: "noPrevious" });
  });
});
