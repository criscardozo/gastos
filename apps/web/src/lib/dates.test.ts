import { describe, expect, it } from "vitest";

import { formatMonthLabel, formatPeriodRange } from "./dates";

describe("formatPeriodRange", () => {
  it("says the month once when both ends are in it", () => {
    expect(formatPeriodRange("2026-07-01", "2026-07-14", "es")).toBe(
      "1 – 14 de julio",
    );
    expect(formatPeriodRange("2026-07-01", "2026-07-14", "en")).toBe(
      "1 – 14 July",
    );
  });

  it("names both months when the range crosses one", () => {
    expect(formatPeriodRange("2026-07-28", "2026-08-10", "es")).toBe(
      "28 jul – 10 ago",
    );
  });

  it("adds the years when the range crosses one", () => {
    // Without them, the twelve-month range reads as a fortnight in the wrong
    // order — "1 sep – 31 ago" looks like a typo rather than a year.
    expect(formatPeriodRange("2025-09-01", "2026-08-31", "es")).toBe(
      "1 sept 2025 – 31 ago 2026",
    );
  });

  it("keeps the year out of ranges that do not need it", () => {
    // Every ordinary period is inside one year, and printing it there would be
    // noise on the screen people look at every day.
    expect(formatPeriodRange("2026-03-01", "2026-08-31", "es")).not.toMatch(
      /2026/,
    );
  });
});

describe("formatMonthLabel", () => {
  it("names the month and always its year", () => {
    // Always, unlike the day formats: this is a label somebody navigates back
    // through, and "agosto" alone stops identifying anything at the twelfth.
    expect(formatMonthLabel("2026-08-01", "es")).toBe("agosto 2026");
    expect(formatMonthLabel("2026-08-01", "en")).toBe("August 2026");
    expect(formatMonthLabel("2025-12-31", "es")).toBe("diciembre 2025");
  });
});
