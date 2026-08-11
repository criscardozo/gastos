import { describe, expect, it } from "vitest";

import {
  compareByDueDate,
  daysUntilDue,
  intervalMonths,
  monthlyTotals,
  nextDueDate,
  type DueRule,
} from "./services";

const monthly = (dueDay: number): DueRule => ({ interval: "monthly", dueDay });

describe("intervalMonths", () => {
  it("maps every interval to its month step", () => {
    expect(intervalMonths("monthly")).toBe(1);
    expect(intervalMonths("bimonthly")).toBe(2);
    expect(intervalMonths("quarterly")).toBe(3);
    expect(intervalMonths("biannual")).toBe(6);
    expect(intervalMonths("yearly")).toBe(12);
  });
});

describe("nextDueDate — monthly", () => {
  it("finds the due day later this month", () => {
    expect(nextDueDate(monthly(7), "2026-08-01")).toBe("2026-08-07");
  });

  it("counts the due day itself as due, not as past", () => {
    expect(nextDueDate(monthly(7), "2026-08-07")).toBe("2026-08-07");
  });

  it("rolls to next month once the day has passed", () => {
    expect(nextDueDate(monthly(7), "2026-08-08")).toBe("2026-09-07");
  });

  it("crosses the year boundary", () => {
    expect(nextDueDate(monthly(5), "2026-12-10")).toBe("2027-01-05");
  });
});

describe("nextDueDate — short months", () => {
  it("clamps the 31st to the end of a 30-day month", () => {
    expect(nextDueDate(monthly(31), "2026-04-15")).toBe("2026-04-30");
  });

  it("clamps the 31st to 28 February in a common year", () => {
    expect(nextDueDate(monthly(31), "2026-02-01")).toBe("2026-02-28");
  });

  it("clamps the 31st to 29 February in a leap year", () => {
    expect(nextDueDate(monthly(31), "2024-02-01")).toBe("2024-02-29");
  });

  it("still reports the clamped day as due on that day", () => {
    // The bill "due on the 31st" is due on the 28th here — being past the 28th
    // has to send it to March, not leave it stuck in February.
    expect(nextDueDate(monthly(31), "2026-02-28")).toBe("2026-02-28");
    expect(nextDueDate(monthly(31), "2026-03-01")).toBe("2026-03-31");
  });
});

describe("nextDueDate — intervals longer than a month", () => {
  const yearly: DueRule = { interval: "yearly", dueDay: 15, anchorMonth: 3 };

  it("skips forward to the anchor month", () => {
    expect(nextDueDate(yearly, "2026-08-01")).toBe("2027-03-15");
  });

  it("stays in the anchor month while the day is still ahead", () => {
    expect(nextDueDate(yearly, "2026-03-10")).toBe("2026-03-15");
  });

  it("waits a full year once the anchor month's day has passed", () => {
    expect(nextDueDate(yearly, "2026-03-16")).toBe("2027-03-15");
  });

  it("quarterly lands on the anchor month and every third one after", () => {
    // anchor 1 ⇒ January, April, July, October
    const quarterly: DueRule = {
      interval: "quarterly",
      dueDay: 10,
      anchorMonth: 1,
    };
    expect(nextDueDate(quarterly, "2026-08-01")).toBe("2026-10-10");
    expect(nextDueDate(quarterly, "2026-04-09")).toBe("2026-04-10");
    // anchor 2 ⇒ February, May, August, November
    const shifted: DueRule = {
      interval: "quarterly",
      dueDay: 10,
      anchorMonth: 2,
    };
    expect(nextDueDate(shifted, "2026-08-11")).toBe("2026-11-10");
  });

  it("bimonthly alternates months from the anchor", () => {
    const bimonthly: DueRule = {
      interval: "bimonthly",
      dueDay: 20,
      anchorMonth: 1,
    };
    expect(nextDueDate(bimonthly, "2026-08-21")).toBe("2026-09-20");
  });

  it("biannual falls twice a year", () => {
    const biannual: DueRule = {
      interval: "biannual",
      dueDay: 1,
      anchorMonth: 6,
    };
    expect(nextDueDate(biannual, "2026-08-01")).toBe("2026-12-01");
    expect(nextDueDate(biannual, "2026-12-02")).toBe("2027-06-01");
  });

  it("treats a missing anchor as January rather than throwing", () => {
    // The rules require one off-monthly, but a doc written by an older client
    // must still render a date instead of blowing up the list.
    const bare: DueRule = { interval: "quarterly", dueDay: 5 };
    expect(nextDueDate(bare, "2026-08-01")).toBe("2026-10-05");
  });
});

describe("daysUntilDue", () => {
  it("counts whole days, with 0 meaning today", () => {
    expect(daysUntilDue(monthly(7), "2026-08-01")).toBe(6);
    expect(daysUntilDue(monthly(7), "2026-08-07")).toBe(0);
  });

  it("counts across a month boundary", () => {
    expect(daysUntilDue(monthly(3), "2026-08-30")).toBe(4); // → 2026-09-03
  });
});

describe("compareByDueDate", () => {
  it("puts the soonest first and breaks ties by name", () => {
    const rows = [
      { name: "Seguro", interval: "monthly" as const, dueDay: 20 },
      { name: "Netflix", interval: "monthly" as const, dueDay: 7 },
      { name: "Agua", interval: "monthly" as const, dueDay: 7 },
    ];
    expect(
      [...rows].sort(compareByDueDate("2026-08-01")).map((r) => r.name),
    ).toEqual(["Agua", "Netflix", "Seguro"]);
  });
});

describe("monthlyTotals", () => {
  it("normalises every interval to a month before adding up", () => {
    const totals = monthlyTotals([
      { interval: "monthly", dueDay: 7, amountAudCents: 2299 },
      { interval: "yearly", dueDay: 1, anchorMonth: 3, amountAudCents: 12000 },
      { interval: "quarterly", dueDay: 1, anchorMonth: 1, amountUsdCents: 3000 },
    ]);
    expect(totals.audCents).toBe(2299 + 1000);
    expect(totals.usdCents).toBe(1000);
  });

  it("treats a missing amount as nothing, not as a zero row to skip", () => {
    const totals = monthlyTotals([
      { interval: "monthly", dueDay: 1, amountUsdCents: 1499 },
    ]);
    expect(totals).toEqual({ audCents: 0, usdCents: 1499 });
  });
});
