import { describe, expect, it } from "vitest";

import {
  biggest,
  byCategory,
  byDay,
  byMember,
  byWeekday,
  cumulative,
  pace,
  totals,
  verification,
  weekdayIndex,
  type StatExpense,
} from "./stats";

function expense(over: Partial<StatExpense> = {}): StatExpense {
  return {
    id: Math.random().toString(36).slice(2),
    amountCents: 1000,
    categoryId: "groceries",
    note: "",
    date: "2026-08-03", // a Monday
    createdBy: "u1",
    usdCents: null,
    verified: false,
    ...over,
  };
}

const WEEK = { startDate: "2026-08-03", endDate: "2026-08-09" }; // Mon–Sun

describe("totals", () => {
  it("sums, counts and averages", () => {
    const t = totals(
      [expense({ amountCents: 1000 }), expense({ amountCents: 2000 })],
      WEEK,
    );
    expect(t.totalCents).toBe(3000);
    expect(t.count).toBe(2);
    expect(t.averageCents).toBe(1500);
  });

  it("spreads the total over every day in the range, not the busy ones", () => {
    // 700,00 across a 7-day week is 100,00 a day even if it all landed on one.
    const t = totals([expense({ amountCents: 70000 })], WEEK);
    expect(t.perDayCents).toBe(10000);
    expect(t.daysWithoutSpending).toBe(6);
  });

  it("survives an empty range without dividing by zero", () => {
    const t = totals([], WEEK);
    expect(t).toMatchObject({
      totalCents: 0,
      count: 0,
      averageCents: 0,
      perDayCents: 0,
      biggest: null,
      daysWithoutSpending: 7,
    });
  });

  it("finds the biggest expense", () => {
    const t = totals(
      [
        expense({ amountCents: 500, note: "chico" }),
        expense({ amountCents: 9000, note: "grande" }),
        expense({ amountCents: 800, note: "medio" }),
      ],
      WEEK,
    );
    expect(t.biggest?.note).toBe("grande");
  });
});

describe("byCategory", () => {
  it("groups, sorts by size and shares add up to one", () => {
    const slices = byCategory([
      expense({ categoryId: "coffee", amountCents: 500 }),
      expense({ categoryId: "groceries", amountCents: 6000 }),
      expense({ categoryId: "coffee", amountCents: 500 }),
    ]);
    expect(slices.map((s) => s.categoryId)).toEqual(["groceries", "coffee"]);
    expect(slices[1].count).toBe(2);
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
  });

  it("has no shares to hand out when nothing was spent", () => {
    expect(byCategory([])).toEqual([]);
  });
});

describe("byDay", () => {
  it("emits every day of the range, quiet ones as zero", () => {
    const days = byDay([expense({ date: "2026-08-05", amountCents: 1200 })], WEEK);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2026-08-03", totalCents: 0 });
    expect(days[2]).toEqual({ date: "2026-08-05", totalCents: 1200 });
  });

  it("adds up several expenses on the same day", () => {
    const days = byDay(
      [
        expense({ date: "2026-08-04", amountCents: 300 }),
        expense({ date: "2026-08-04", amountCents: 700 }),
      ],
      WEEK,
    );
    expect(days[1].totalCents).toBe(1000);
  });
});

describe("cumulative", () => {
  it("runs the total forward and ends on the sum", () => {
    const running = cumulative([
      { date: "a", totalCents: 100 },
      { date: "b", totalCents: 0 },
      { date: "c", totalCents: 250 },
    ]);
    expect(running.map((d) => d.totalCents)).toEqual([100, 100, 350]);
  });
});

describe("weekdayIndex", () => {
  it("counts the week from Monday", () => {
    expect(weekdayIndex("2026-08-03")).toBe(0); // Monday
    expect(weekdayIndex("2026-08-08")).toBe(5); // Saturday
    expect(weekdayIndex("2026-08-09")).toBe(6); // Sunday
  });
});

describe("byWeekday", () => {
  it("averages over how often that weekday occurs, not over the range", () => {
    // Two Mondays in the range, one with 100,00 and one with nothing.
    const range = { startDate: "2026-08-03", endDate: "2026-08-16" };
    const week = byWeekday([expense({ date: "2026-08-03", amountCents: 10000 })], range);
    expect(week[0].totalCents).toBe(10000);
    expect(week[0].averageCents).toBe(5000); // 10000 / 2 Mondays
    expect(week[1].averageCents).toBe(0);
  });

  it("always returns the seven days", () => {
    expect(byWeekday([], WEEK)).toHaveLength(7);
  });
});

describe("byMember", () => {
  it("splits by who entered it, biggest first", () => {
    const slices = byMember([
      expense({ createdBy: "alice", amountCents: 1000 }),
      expense({ createdBy: "bob", amountCents: 4000 }),
      expense({ createdBy: "alice", amountCents: 1000 }),
    ]);
    expect(slices[0]).toMatchObject({ uid: "bob", totalCents: 4000, count: 1 });
    expect(slices[1].share).toBeCloseTo(0.333, 3);
  });
});

describe("verification", () => {
  it("counts both sides and totals the bank's USD", () => {
    const summary = verification([
      expense({ amountCents: 10000, usdCents: 7120, verified: true }),
      expense({ amountCents: 5000, usdCents: 3560, verified: true }),
      expense({ amountCents: 2000 }),
    ]);
    expect(summary).toMatchObject({
      verified: 2,
      unverified: 1,
      usdCents: 10680,
      verifiedAudCents: 15000,
    });
    expect(summary.rate).toBeCloseTo(0.712, 3);
  });

  it("ignores a flag with no figure behind it", () => {
    const summary = verification([expense({ verified: true, usdCents: null })]);
    expect(summary).toMatchObject({ verified: 0, unverified: 1, rate: null });
  });

  it("takes the median rate, so one mistyped pair cannot skew it", () => {
    const summary = verification([
      expense({ amountCents: 10000, usdCents: 7120, verified: true }),
      expense({ amountCents: 10000, usdCents: 7130, verified: true }),
      expense({ amountCents: 10000, usdCents: 712, verified: true }), // typo
    ]);
    expect(summary.rate).toBeCloseTo(0.712, 3);
  });
});

describe("biggest", () => {
  it("returns the top few, largest first", () => {
    const top = biggest(
      [100, 900, 500, 300].map((amountCents) => expense({ amountCents })),
      2,
    );
    expect(top.map((e) => e.amountCents)).toEqual([900, 500]);
  });

  it("does not reorder the caller's array", () => {
    const input = [expense({ amountCents: 1 }), expense({ amountCents: 2 })];
    biggest(input);
    expect(input[0].amountCents).toBe(1);
  });
});

describe("pace", () => {
  it("spreads the budget evenly and lands exactly on it", () => {
    const line = pace(70000, 7);
    expect(line).toHaveLength(7);
    expect(line[0]).toBe(10000);
    expect(line[6]).toBe(70000);
  });

  it("has nothing to draw for an empty range", () => {
    expect(pace(90000, 0)).toEqual([]);
  });
});
