import { describe, expect, it } from "vitest";

import {
  addMonthsKeepingDay,
  containsCharge,
  currentStatement,
  isPastClosing,
  nextStatementProposal,
  statementTotalUsdCents,
  totalsByCard,
  type StatementRange,
} from "./statements";

const august: StatementRange = {
  startDate: "2026-07-28",
  closingDate: "2026-08-27",
  dueDate: "2026-09-07",
};

const july: StatementRange = {
  startDate: "2026-06-28",
  closingDate: "2026-07-27",
  dueDate: "2026-08-07",
};

describe("containsCharge", () => {
  it("includes both ends of the window", () => {
    expect(containsCharge(august, "2026-07-28")).toBe(true);
    expect(containsCharge(august, "2026-08-27")).toBe(true);
  });

  it("excludes anything outside it", () => {
    expect(containsCharge(august, "2026-07-27")).toBe(false);
    expect(containsCharge(august, "2026-08-28")).toBe(false);
  });
});

describe("currentStatement", () => {
  it("is the one that closes last, whatever order they arrive in", () => {
    expect(currentStatement([july, august])?.closingDate).toBe("2026-08-27");
    expect(currentStatement([august, july])?.closingDate).toBe("2026-08-27");
  });

  it("is null before the first one is opened", () => {
    expect(currentStatement([])).toBeNull();
  });
});

describe("addMonthsKeepingDay", () => {
  it("keeps the day of the month", () => {
    expect(addMonthsKeepingDay("2026-08-27", 1)).toBe("2026-09-27");
  });

  it("crosses the year boundary", () => {
    expect(addMonthsKeepingDay("2026-12-27", 1)).toBe("2027-01-27");
  });

  it("clamps into a shorter month instead of spilling into the next", () => {
    expect(addMonthsKeepingDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsKeepingDay("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsKeepingDay("2026-03-31", 1)).toBe("2026-04-30");
  });
});

describe("nextStatementProposal", () => {
  it("starts the day after the one being closed, so no charge falls between", () => {
    const next = nextStatementProposal(august);
    expect(next.startDate).toBe("2026-08-28");
    expect(containsCharge(august, "2026-08-27")).toBe(true);
    expect(containsCharge(next, "2026-08-28")).toBe(true);
  });

  it("moves both dates on a month, keeping their day", () => {
    expect(nextStatementProposal(august)).toEqual({
      startDate: "2026-08-28",
      closingDate: "2026-09-27",
      dueDate: "2026-10-07",
    });
  });

  it("keeps the due date after the closing date across a short month", () => {
    const january: StatementRange = {
      startDate: "2025-12-29",
      closingDate: "2026-01-28",
      dueDate: "2026-02-08",
    };
    const next = nextStatementProposal(january);
    expect(next.closingDate).toBe("2026-02-28");
    expect(next.dueDate).toBe("2026-03-08");
    expect(next.dueDate > next.closingDate).toBe(true);
  });
});

describe("isPastClosing", () => {
  const statement = {
    startDate: "2026-07-28",
    closingDate: "2026-08-27",
    dueDate: "2026-09-10",
  };

  it("is true only after the closing day", () => {
    expect(isPastClosing("2026-08-28", statement)).toBe(true);
    expect(isPastClosing("2026-09-30", statement)).toBe(true);
  });

  it("the closing day itself still belongs to the statement", () => {
    // The bank's own boundary is inclusive — a purchase on the 27th is on this
    // statement, which is why the range query uses <= closingDate.
    expect(isPastClosing("2026-08-27", statement)).toBe(false);
    expect(isPastClosing("2026-08-01", statement)).toBe(false);
  });

  it("says nothing when there is no statement to be past", () => {
    expect(isPastClosing("2026-08-28", null)).toBe(false);
  });
});

describe("totals", () => {
  const charges = [
    { card: "visa", usdCents: 1999 },
    { card: "mastercard", usdCents: 500 },
    { card: "visa", usdCents: 1 },
  ];

  it("adds the statement up in USD cents", () => {
    expect(statementTotalUsdCents(charges)).toBe(2500);
    expect(statementTotalUsdCents([])).toBe(0);
  });

  it("breaks the total down per card", () => {
    expect(totalsByCard(charges)).toEqual({ visa: 2000, mastercard: 500 });
  });
});
