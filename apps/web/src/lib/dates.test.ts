import { describe, expect, it } from "vitest";

import {
  capitaliseFirst,
  formatDayHeading,
  formatLongDate,
  formatMonthLabel,
  formatPeriodRange,
  formatShortDate,
} from "./dates";

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

describe("Spanish names stay lowercase inside a date", () => {
  it("writes months and weekdays as Spanish does", () => {
    // Most of these sit inside a sentence — "cerró el domingo 30 de agosto",
    // "Cobrado el 3 sept" — where a capital month is simply wrong. They used
    // to be capitalised everywhere, and the web wrote "25 Sept" beside the
    // iPhone's "25 sept".
    expect(formatDayHeading("2026-08-30", "es")).toBe("domingo 30 ago");
    expect(formatLongDate("2026-08-30", "es")).toBe("domingo 30 de agosto");
    expect(formatShortDate("2026-09-03", "es")).toBe("3 sept");
    expect(formatPeriodRange("2026-01-01", "2026-01-14", "es")).toContain("enero");
  });

  it("leaves English as it was, since it capitalises them already", () => {
    // en-AU abbreviates September as "Sept" too, so the interesting assertion
    // is not the spelling but that nothing lowercased what English capitalises.
    expect(formatDayHeading("2026-08-30", "en")).toBe("Sunday 30 Aug");
    expect(formatShortDate("2026-09-03", "en")).toBe("3 Sept");
    expect(formatShortDate("2026-10-03", "en")).toBe("3 Oct");
  });
});

describe("capitaliseFirst", () => {
  it("capitalises a date that begins a label, and only its first letter", () => {
    expect(capitaliseFirst(formatLongDate("2026-10-25", "es"))).toBe(
      "Domingo 25 de octubre",
    );
    expect(capitaliseFirst("25 sept")).toBe("25 sept");
  });
});

describe("formatMonthLabel", () => {
  it("names the month and always its year, capitalised as the label it is", () => {
    // Always the year, unlike the day formats: this is a label somebody
    // navigates back through, and "agosto" alone stops identifying anything at
    // the twelfth. And always a heading or a pill, so it begins the label.
    expect(formatMonthLabel("2026-08-01", "es")).toBe("Agosto 2026");
    expect(formatMonthLabel("2026-08-01", "en")).toBe("August 2026");
    expect(formatMonthLabel("2025-12-31", "es")).toBe("Diciembre 2025");
  });
});
