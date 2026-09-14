import { describe, expect, it } from "vitest";

import {
  compareByDueDate,
  daysUntilDue,
  intervalMonths,
  monthTotals,
  nameKey,
  nextDueDate,
  serviceStatuses,
  type ChargeLike,
  type DueRule,
  unmatchedServiceExpenses,
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

/* ── Linking a service to the expense that paid it ─────────────────────── */

const netflix = {
  id: "s1",
  name: "Netflix",
  amountAudCents: 2299,
  amountUsdCents: 1499,
  interval: "monthly" as const,
  dueDay: 7,
};
const insurance = {
  id: "s2",
  name: "Seguro",
  amountAudCents: 60000,
  amountUsdCents: null,
  interval: "quarterly" as const,
  dueDay: 15,
  anchorMonth: 3,
};

function charge(over: Partial<ChargeLike> = {}): ChargeLike {
  return {
    id: "e1",
    amountCents: 2299,
    categoryId: "services",
    note: "Netflix",
    date: "2026-09-07",
    usdCents: null,
    ...over,
  };
}

describe("nameKey", () => {
  it("ignores case, accents and surrounding space", () => {
    // The link is a name typed twice by a person; it has to survive that.
    expect(nameKey("  Telefonía ")).toBe(nameKey("telefonia"));
    expect(nameKey("Netflix")).toBe(nameKey("NETFLIX"));
    expect(nameKey("Luz")).not.toBe(nameKey("Gas"));
  });
});

describe("serviceStatuses", () => {
  it("links an expense to the service whose name it carries", () => {
    const status = serviceStatuses([netflix], [charge()], 9).get("s1")!;
    expect(status.charge?.id).toBe("e1");
    expect(status.differenceCents).toBe(0);
  });

  it("ignores expenses outside the Servicios category", () => {
    // Otherwise a note that happened to say "Netflix" in Ocio would mark the
    // bill as paid. The category is what makes the note mean something.
    const status = serviceStatuses(
      [netflix],
      [charge({ categoryId: "entertainment" })],
      9,
    ).get("s1")!;
    expect(status.charge).toBeNull();
  });

  it("reports what the bill actually came to when it differs", () => {
    // 25,99 charged against 22,99 on file: the expense is the truth, and the
    // screen offers to move the service to it.
    const status = serviceStatuses([netflix], [charge({ amountCents: 2599 })], 9)
      .get("s1")!;
    expect(status.differenceCents).toBe(300);
  });

  it("has nothing to compare for a service quoted only in USD", () => {
    // An AUD expense cannot contradict a USD-only figure, so the honest answer
    // is null rather than a difference measured against zero.
    const usdOnly = { ...netflix, amountAudCents: null };
    const status = serviceStatuses([usdOnly], [charge()], 9).get("s1")!;
    expect(status.charge?.id).toBe("e1");
    expect(status.differenceCents).toBeNull();
  });

  it("knows which services this month even charges", () => {
    // Quarterly from March: due in September, not in October.
    expect(serviceStatuses([insurance], [], 9).get("s2")!.dueThisMonth).toBe(true);
    expect(serviceStatuses([insurance], [], 10).get("s2")!.dueThisMonth).toBe(false);
    // Monthly is due every month, whatever the anchor says.
    expect(serviceStatuses([netflix], [], 10).get("s1")!.dueThisMonth).toBe(true);
  });

  it("picks the same charge every time when a name appears twice", () => {
    // Two charges in one month is a data problem, not a crash — but the answer
    // must not depend on the order the query happened to return them in.
    const charges = [
      charge({ id: "b", date: "2026-09-20", amountCents: 2599 }),
      charge({ id: "a", date: "2026-09-07", amountCents: 2299 }),
    ];
    expect(serviceStatuses([netflix], charges, 9).get("s1")!.charge?.id).toBe("a");
    expect(
      serviceStatuses([netflix], [...charges].reverse(), 9).get("s1")!.charge?.id,
    ).toBe("a");
  });

  it("ignores an expense with an empty note", () => {
    const status = serviceStatuses([netflix], [charge({ note: "  " })], 9).get("s1")!;
    expect(status.charge).toBeNull();
  });
});

describe("monthTotals", () => {
  const services = [netflix, insurance];

  it("counts only the services this month charges", () => {
    // October: Netflix yes, the quarterly insurance no. The old "per month"
    // average put a twelfth of every bill into every month, which is why it
    // could never be reconciled against a real month.
    const statuses = serviceStatuses(services, [], 10);
    const totals = monthTotals(services, statuses);
    expect(totals.dueCount).toBe(1);
    expect(totals.dueAudCents).toBe(2299);
    expect(totals.dueUsdCents).toBe(1499);
    expect(totals.chargedCount).toBe(0);
    expect(totals.chargedAudCents).toBe(0);
  });

  it("adds the quarterly one in its own month", () => {
    const statuses = serviceStatuses(services, [], 9);
    const totals = monthTotals(services, statuses);
    expect(totals.dueCount).toBe(2);
    expect(totals.dueAudCents).toBe(62299);
  });

  it("separates what has landed from what the month costs", () => {
    // Netflix came in at 25,99 rather than 22,99: due says what is on file,
    // charged says what the bank did, and they disagree on purpose.
    const charges = [charge({ amountCents: 2599, usdCents: 1700 })];
    const statuses = serviceStatuses(services, charges, 9);
    const totals = monthTotals(services, statuses);
    expect(totals.dueAudCents).toBe(62299);
    expect(totals.chargedAudCents).toBe(2599);
    expect(totals.chargedUsdCents).toBe(1700);
    expect(totals.chargedCount).toBe(1);
    expect(totals.dueCount).toBe(2);
  });

  it("does not count a charge for a service that is not due this month", () => {
    // A quarterly bill paid in the wrong month is somebody's mistake, not a
    // reason for the month's total to grow.
    const charges = [charge({ note: "Seguro", amountCents: 60000 })];
    const totals = monthTotals(services, serviceStatuses(services, charges, 10));
    expect(totals.chargedAudCents).toBe(0);
    expect(totals.dueAudCents).toBe(2299);
  });
});

describe("Servicios expenses that match no service", () => {
  const services = [
    { id: "s1", name: "Internet Casa", interval: "monthly" as const, dueDay: 7 },
    { id: "s2", name: "YouTube Premium", interval: "monthly" as const, dueDay: 7 },
  ];
  const expense = (id: string, note: string, date: string, categoryId = "services") => ({
    id,
    note,
    date,
    categoryId,
    amountCents: 5000,
  });

  it("finds the one whose note does not name a service", () => {
    // The reported case, verbatim: a service called "Internet Casa" paid with
    // an expense noted "Amaysim Internet Casa", which is what the bill says.
    const out = unmatchedServiceExpenses(services, [
      expense("e1", "Amaysim Internet Casa", "2026-09-13"),
      expense("e2", "YouTube Premium", "2026-09-07"),
    ]);
    expect(out.map((e) => e.id)).toEqual(["e1"]);
  });

  it("ignores expenses outside the Servicios category", () => {
    // Without this it would offer every unrelated expense as a candidate.
    const out = unmatchedServiceExpenses(services, [
      expense("e1", "Nafta", "2026-09-13", "transport"),
    ]);
    expect(out).toEqual([]);
  });

  it("matches the same way the link does — case and accents", () => {
    const out = unmatchedServiceExpenses(services, [
      expense("e1", "  internet casa  ", "2026-09-13"),
    ]);
    expect(out).toEqual([]);
  });

  it("returns nothing when every note names a service", () => {
    // The control: a function that always returned its input would pass the
    // first test and be useless.
    expect(
      unmatchedServiceExpenses(services, [
        expense("e1", "Internet Casa", "2026-09-13"),
      ]),
    ).toEqual([]);
  });
});
