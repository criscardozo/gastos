// The shared vectors, run against the TypeScript matcher. The Swift one runs
// the same file (apps/ios/GastosDiariosTests/BankMatchTests.swift), which is the
// only thing keeping two implementations of this honest.

import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/bank-match-vectors.json";
import {
  learnRate,
  suggestMatches,
  type BankCharge,
  type MatchableExpense,
} from "./bank-match";

describe("bank match vectors", () => {
  it("runs every group in the file", () => {
    const groups = Object.keys(vectors).filter((key) => key !== "_comment");
    expect(new Set(groups)).toEqual(new Set(["learnRate", "suggestMatches"]));
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
      })),
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
