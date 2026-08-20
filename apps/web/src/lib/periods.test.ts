import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/period-test-vectors.json";
import {
  addDays,
  budgetState,
  cascadeMaterialization,
  containsDate,
  daysBetween,
  extendToFortnight,
  periodEndDate,
  todayInTimezone,
  type PeriodType,
} from "./periods";
import {
  formatCents,
  formatCentsCompact,
  formatUsd,
  parseAmountToCents,
} from "./money";

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
