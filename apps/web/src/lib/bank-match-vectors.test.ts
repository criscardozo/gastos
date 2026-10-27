// The shared vectors, run against the TypeScript matcher. The Swift one runs
// the same file (apps/ios/GastosTests/BankMatchTests.swift), which is the
// only thing keeping two implementations of this honest.

import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/bank-match-vectors.json";
import {
  learnRate,
  learnRateAsOf,
  RATE_WINDOW_DAYS,
  suggestMatches,
  type BankCharge,
  type MatchableExpense,
} from "./bank-match";

describe("bank match vectors", () => {
  it("runs every group in the file", () => {
    const groups = Object.keys(vectors).filter((key) => key !== "_comment");
    expect(new Set(groups)).toEqual(new Set(["learnRate", "learnRateWindow", "suggestMatches"]));
  });
});

describe("shared vectors: learnRate", () => {
  it.each(vectors.learnRate)("$name", ({ expenses, expected }) => {
    const rate = learnRate(
      expenses.map((e, i) => ({
        id: `e${i}`,
        amountCents: e.amountCents,
        date: "2026-08-03",
        note: "",
        verified: e.verified,
        usdCents: e.usdCents,
        autoEstimated: "autoEstimated" in e ? e.autoEstimated === true : false,
      })),
    );
    if (expected === null) {
      expect(rate).toBeNull();
    } else {
      expect(rate).toBeCloseTo(expected, 6);
    }
  });
});

describe("shared vectors: learnRateWindow", () => {
  it("uses the window the vectors name", () => {
    expect(RATE_WINDOW_DAYS).toBe(vectors.learnRateWindow.windowDays);
  });

  it.each(vectors.learnRateWindow.cases)("$name", ({ today, expenses, expected }) => {
    const rate = learnRateAsOf(
      expenses.map((e, i) => ({
        id: `e${i}`,
        amountCents: e.amountCents,
        date: e.date,
        note: "",
        verified: e.verified,
        usdCents: e.usdCents,
        autoEstimated: false,
      })),
      today,
    );
    if (expected === null) {
      expect(rate).toBeNull();
    } else {
      expect(rate).toBeCloseTo(expected, 6);
    }
  });
});

describe("shared vectors: suggestMatches", () => {
  it.each(vectors.suggestMatches)(
    "$name",
    ({ referenceRate, charges, expenses, expected }) => {
      const suggestions = suggestMatches(
        charges.map<BankCharge>((c) => ({
          id: c.id,
          usdCents: c.usdCents,
          date: c.date,
          merchant: c.merchant,
          cardLast4: null,
        })),
        expenses.map<MatchableExpense>((e) => ({
          id: e.id,
          amountCents: e.amountCents,
          date: e.date,
          note: e.note,
          verified: e.verified,
        })),
        referenceRate,
      );
      const actual = Object.fromEntries(
        suggestions.map((s) => [s.charge.id, s.expenseId]),
      );
      expect(actual).toEqual(expected);
    },
  );
});
