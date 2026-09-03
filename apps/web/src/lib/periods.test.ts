import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/period-test-vectors.json";
import {
  addDays,
  budgetState,
  cascadeMaterialization,
  containsDate,
  daysBetween,
  extendToFortnight,
  monthRange,
  monthsBackRange,
  periodEndDate,
  recentMonths,
  stretchPeriodTo,
  todayInTimezone,
  type PeriodType,
} from "./periods";
import {
  formatCents,
  formatCentsCompact,
  formatUsd,
  parseAmountToCents,
} from "./money";

/**
 * The file and the suite agree on how much is being run.
 *
 * A group added to the vectors that no test reads would leave this suite green
 * having covered less — the same trap on the Swift side, where Decodable
 * silently ignores keys the struct does not declare. Pinned on both platforms
 * because the whole point of the shared file is that neither drifts.
 */
describe("period vectors", () => {
  it("runs every group in the file", () => {
    const groups = Object.keys(vectors).filter(
      (key) => key !== "version" && key !== "comment",
    );
    expect(new Set(groups)).toEqual(
      new Set([
        "addDays",
        "daysBetween",
        "periodEndDate",
        "containment",
        "cascadeMaterialization",
        "todayInTimezone",
        "budgetState",
        "extendToFortnight",
      ]),
    );
  });

  it("runs the number of cases the suite thinks it does", () => {
    const counted =
      vectors.addDays.length +
      vectors.daysBetween.length +
      vectors.periodEndDate.length +
      vectors.containment.length +
      vectors.cascadeMaterialization.cases.length +
      vectors.todayInTimezone.cases.length +
      vectors.budgetState.cases.length +
      vectors.extendToFortnight.cases.length;
    expect(counted).toBe(58);
  });
});

describe("addDays", () => {
  it.each(vectors.addDays)(
    "$date + $days days = $expected",
    ({ date, days, expected }) => {
      expect(addDays(date, days)).toBe(expected);
    },
  );
});

describe("daysBetween", () => {
  it.each(vectors.daysBetween)(
    "$from → $to = $expected",
    ({ from, to, expected }) => {
      expect(daysBetween(from, to)).toBe(expected);
    },
  );
});

describe("periodEndDate", () => {
  it.each(vectors.periodEndDate)(
    "$startDate ($period) ends $expected",
    ({ startDate, period, expected }) => {
      expect(periodEndDate(startDate, period as PeriodType)).toBe(expected);
    },
  );
});

describe("containsDate", () => {
  it.each(vectors.containment)(
    "[$startDate, $endDate] contains $date → $expected",
    ({ startDate, endDate, date, expected }) => {
      expect(containsDate({ startDate, endDate }, date)).toBe(expected);
    },
  );
});

describe("cascadeMaterialization", () => {
  it.each(vectors.cascadeMaterialization.cases)(
    "$name",
    ({ last, anchorDate, defaultPeriod, today, expected }) => {
      expect(
        cascadeMaterialization(
          last ?? null,
          anchorDate ?? null,
          defaultPeriod as PeriodType,
          today,
        ),
      ).toEqual(expected);
    },
  );
});

describe("todayInTimezone", () => {
  it.each(vectors.todayInTimezone.cases)(
    "$instant in $timezone is $expected",
    ({ instant, timezone, expected }) => {
      expect(todayInTimezone(new Date(instant), timezone)).toBe(expected);
    },
  );
});

describe("extendToFortnight (shared vectors)", () => {
  it.each(vectors.extendToFortnight.cases)(
    "$name",
    ({ startDate, endDate, period, expectedEndDate, expectedAddedDays }) => {
      const result = extendToFortnight({
        startDate,
        endDate,
        period: period as PeriodType,
      });
      if (expectedEndDate === null) {
        expect(result).toBeNull();
        return;
      }
      expect(result).not.toBeNull();
      expect(result!.endDate).toBe(expectedEndDate);
      expect(result!.addedDays).toBe(expectedAddedDays);
    },
  );

  it("leaves the start where it was, so the next period keeps the weekday", () => {
    // The point of the whole feature: Cristian's weeks run Friday to Thursday,
    // and an extended one must still hand over on a Friday.
    const week = {
      startDate: "2026-08-07",
      endDate: "2026-08-13",
      period: "weekly" as PeriodType,
    };
    const extended = extendToFortnight(week)!;
    expect(addDays(extended.endDate, 1)).toBe("2026-08-21");
    expect(addDays(week.endDate, 1)).toBe("2026-08-14");
    // Both are Fridays; the handover just moved a week later.
    expect(daysBetween("2026-08-14", "2026-08-21")).toBe(7);
  });

  it("swallows the days that would have been the next period", () => {
    const extended = extendToFortnight({
      startDate: "2026-08-07",
      endDate: "2026-08-13",
      period: "weekly",
    })!;
    // An expense dated in the added week now falls INSIDE this period, which is
    // what makes the extension work without touching a single expense doc.
    const range = { startDate: "2026-08-07", endDate: extended.endDate };
    expect(containsDate(range, "2026-08-14")).toBe(true);
    expect(containsDate(range, "2026-08-20")).toBe(true);
    expect(containsDate(range, "2026-08-21")).toBe(false);
  });
});

describe("budgetState", () => {
  it.each(vectors.budgetState.cases)(
    "$spentCents of $budgetCents → $expected",
    ({ spentCents, budgetCents, expected }) => {
      expect(budgetState(spentCents, budgetCents)).toBe(expected);
    },
  );
});

describe("money formatting", () => {
  it("formats es with comma decimals and dot thousands", () => {
    expect(formatCents(105000, "AUD", "es")).toBe("$1.050,00");
    expect(formatCents(90000, "AUD", "es")).toBe("$900,00");
    expect(formatCents(1250, "AUD", "es")).toBe("$12,50");
  });

  it("formats en with dot decimals and comma thousands", () => {
    expect(formatCents(105000, "AUD", "en")).toBe("$1,050.00");
    expect(formatCents(1250, "AUD", "en")).toBe("$12.50");
  });

  it("formats negatives", () => {
    expect(formatCents(-9731, "AUD", "es")).toBe("-$97,31");
  });

  it("drops decimals for whole compact amounts", () => {
    expect(formatCentsCompact(90000, "AUD", "es")).toBe("$900");
    expect(formatCentsCompact(45000, "AUD", "en")).toBe("$450");
    expect(formatCentsCompact(105050, "AUD", "es")).toBe("$1.050,50");
  });

  it("formats the USD charge the bank reported", () => {
    expect(formatUsd(18690, "es")).toBe("US$ 186,90");
    expect(formatUsd(18690, "en")).toBe("US$ 186.90");
  });

  it("parses comma and dot decimal input to cents", () => {
    // Amount parsing has its own suite now (money.test.ts), where the
    // locale-dependent cases live.
    expect(parseAmountToCents("12,50", "es")).toBe(1250);
  });
});

describe("calendar months", () => {
  it("bounds a month by its real last day", () => {
    expect(monthRange("2026-08-30")).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(monthRange("2026-02-14").endDate).toBe("2026-02-28");
    // 2028 is a leap year, and the length is computed rather than tabulated.
    expect(monthRange("2028-02-01").endDate).toBe("2028-02-29");
    expect(monthRange("2026-04-05").endDate).toBe("2026-04-30");
  });

  it("walks backwards across a year boundary", () => {
    // The case a hand-rolled `month - i` gets wrong: month 1 minus 2 is not
    // month -1, it is November of the year before.
    const months = recentMonths("2026-01-15", 3);
    expect(months.map((m) => m.startDate)).toEqual([
      "2026-01-01",
      "2025-12-01",
      "2025-11-01",
    ]);
    expect(months[2].endDate).toBe("2025-11-30");
  });

  it("spans whole months, first day to last", () => {
    expect(monthsBackRange("2026-08-30", 6)).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-08-31",
    });
    expect(monthsBackRange("2026-08-30", 12)).toEqual({
      startDate: "2025-09-01",
      endDate: "2026-08-31",
    });
    // One month back is that month itself, not an empty range.
    expect(monthsBackRange("2026-08-30", 1)).toEqual(monthRange("2026-08-30"));
  });
});

describe("stretchPeriodTo", () => {
  // Cristian's real case: the week 28 Aug – 3 Sep ended with $55,31 left, and
  // he wanted those days to run through Sunday the 6th so the next week starts
  // on Monday the 7th.
  const week = { startDate: "2026-08-28", endDate: "2026-09-03" };

  it("moves the end date out and says by how much", () => {
    expect(stretchPeriodTo(week, "2026-09-06", "2026-09-04")).toEqual({
      endDate: "2026-09-06",
      addedDays: 3,
    });
  });

  it("refuses to shrink", () => {
    // A shorter period would orphan any expense already logged in the days it
    // gave up — they would fall outside every materialized period.
    expect(stretchPeriodTo(week, "2026-09-01", "2026-09-04")).toBeNull();
    expect(stretchPeriodTo(week, "2026-09-03", "2026-09-04")).toBeNull();
  });

  it("refuses to end before today", () => {
    // Answering "stretch it to last Tuesday" on a Friday is not a stretch.
    expect(stretchPeriodTo(week, "2026-09-04", "2026-09-10")).toBeNull();
  });

  it("refuses a length that is a typo rather than a week", () => {
    // 31 days from the start is the cap: past that this is a mistyped year.
    expect(stretchPeriodTo(week, "2026-09-27", "2026-09-04")).toEqual({
      endDate: "2026-09-27",
      addedDays: 24,
    });
    expect(stretchPeriodTo(week, "2026-09-28", "2026-09-04")).toBeNull();
    expect(stretchPeriodTo(week, "2027-09-06", "2026-09-04")).toBeNull();
  });

  it("refuses anything that is not a calendar date", () => {
    expect(stretchPeriodTo(week, "", "2026-09-04")).toBeNull();
    expect(stretchPeriodTo(week, "2026-9-6", "2026-09-04")).toBeNull();
  });
});
