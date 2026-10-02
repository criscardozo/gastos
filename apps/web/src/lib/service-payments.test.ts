import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/service-payments-vectors.json";
import { previousMonth, servicePayments } from "./service-payments";

// Twice implemented — here and ServicePayments.swift — so both run this file.
describe("service payments (shared vectors)", () => {
  it("has the cases the file declares", () => {
    // Exact: the population is the file's own list, closed by construction.
    expect(vectors.previousMonth.length).toBe(4);
    expect(vectors.payments.length).toBe(3);
  });

  it("finds the month before", () => {
    for (const c of vectors.previousMonth) {
      expect(previousMonth(c.today), c.today).toEqual({
        startDate: c.startDate,
        endDate: c.endDate,
      });
    }
  });

  it("lists and totals what was paid", () => {
    for (const c of vectors.payments) {
      const result = servicePayments(c.expenses);
      expect(
        {
          ids: result.rows.map((r) => r.id),
          totalAudCents: result.totalAudCents,
          totalUsdCents: result.totalUsdCents,
          unverified: result.unverified,
        },
        c.name,
      ).toEqual(c.expected);
    }
  });
});
