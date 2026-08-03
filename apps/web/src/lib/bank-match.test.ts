import { describe, expect, it } from "vitest";

import {
  learnRate,
  suggestMatches,
  type BankCharge,
  type MatchableExpense,
} from "./bank-match";

function expense(
  over: Partial<MatchableExpense & { usdCents: number | null }> = {},
): MatchableExpense & { usdCents: number | null } {
  return {
    id: "e1",
    amountCents: 6390,
    date: "2026-08-01",
    note: "Coles",
    verified: false,
    usdCents: null,
    ...over,
  };
}

function charge(over: Partial<BankCharge> = {}): BankCharge {
  return {
    id: "gmail-1",
    usdCents: 4152, // 63.90 AUD at ~0.65
    date: "2026-08-01",
    merchant: "COLES 0831",
    cardLast4: "2024",
    ...over,
  };
}

describe("learnRate", () => {
  it("is null until something has been verified", () => {
    expect(learnRate([expense(), expense({ id: "e2" })])).toBeNull();
  });

  it("takes the median of the verified pairs, so one bad pair cannot drag it", () => {
    const rate = learnRate([
      expense({ id: "a", amountCents: 10000, usdCents: 6500, verified: true }),
      expense({ id: "b", amountCents: 20000, usdCents: 13000, verified: true }),
      // A mistyped verification: 10x off. The median ignores it.
      expense({ id: "c", amountCents: 10000, usdCents: 650, verified: true }),
    ]);
    expect(rate).toBeCloseTo(0.65, 10);
  });

  it("ignores a flag with no figure behind it", () => {
    expect(
      learnRate([expense({ verified: true, usdCents: null })]),
    ).toBeNull();
  });
});

describe("suggestMatches", () => {
  it("matches on the learned rate alone, with no merchant help", () => {
    const [suggestion] = suggestMatches(
      [charge({ merchant: "" })],
      [
        expense({ id: "right", note: "" }),
        expense({ id: "wrong", note: "", amountCents: 1200 }),
      ],
      0.65,
    );
    expect(suggestion.expenseId).toBe("right");
    expect(suggestion.impliedRate).toBeCloseTo(0.65, 2);
  });

  it("prefers the expense whose merchant matches when two rates are close", () => {
    const [suggestion] = suggestMatches(
      [charge()],
      [
        expense({ id: "coles", note: "Coles" }),
        expense({ id: "tren", note: "Tren a Bondi", amountCents: 6400 }),
      ],
      0.65,
    );
    expect(suggestion.expenseId).toBe("coles");
  });

  it("looks a few days back but not further", () => {
    const near = suggestMatches(
      [charge({ date: "2026-08-04" })],
      [expense({ date: "2026-08-01" })],
      0.65,
    );
    expect(near[0].expenseId).toBe("e1");

    const far = suggestMatches(
      [charge({ date: "2026-08-05" })],
      [expense({ date: "2026-08-01" })],
      0.65,
    );
    expect(far[0].expenseId).toBeNull();
  });

  it("never touches an already-verified expense", () => {
    const [suggestion] = suggestMatches(
      [charge()],
      [expense({ verified: true, usdCents: 4152 })],
      0.65,
    );
    expect(suggestion.expenseId).toBeNull();
  });

  it("refuses a pair whose implied rate is nowhere near the learned one", () => {
    // 41.52 USD against a 12.00 AUD expense implies 3.46 — not this bank.
    const [suggestion] = suggestMatches(
      [charge()],
      [expense({ amountCents: 1200 })],
      0.65,
    );
    expect(suggestion.expenseId).toBeNull();
  });

  it("falls back to a plausible band before anything has been verified", () => {
    const [plausible] = suggestMatches([charge()], [expense()], null);
    expect(plausible.expenseId).toBe("e1");

    // 41.52 USD for a 500 AUD expense (rate 0.08) is not a plausible charge.
    const [implausible] = suggestMatches(
      [charge()],
      [expense({ amountCents: 50000 })],
      null,
    );
    expect(implausible.expenseId).toBeNull();
  });

  it("gives each expense to a single charge", () => {
    const suggestions = suggestMatches(
      [
        charge({ id: "c1", usdCents: 4152, merchant: "COLES 0831" }),
        charge({ id: "c2", usdCents: 4152, merchant: "COLES 0831" }),
      ],
      [expense({ id: "only" })],
      0.65,
    );
    const assigned = suggestions.filter((s) => s.expenseId !== null);
    expect(assigned).toHaveLength(1);
    expect(suggestions.map((s) => s.charge.id)).toEqual(["c1", "c2"]);
  });

  it("assigns two charges to the right two expenses", () => {
    const suggestions = suggestMatches(
      [
        charge({ id: "big", usdCents: 4152, merchant: "COLES 0831" }),
        charge({ id: "small", usdCents: 813, merchant: "OPAL TOP UP" }),
      ],
      [
        expense({ id: "coles", amountCents: 6390, note: "Coles" }),
        expense({ id: "opal", amountCents: 1250, note: "Opal" }),
      ],
      0.65,
    );
    const byCharge = new Map(suggestions.map((s) => [s.charge.id, s.expenseId]));
    expect(byCharge.get("big")).toBe("coles");
    expect(byCharge.get("small")).toBe("opal");
  });

  it("returns one entry per charge, even the unmatched ones", () => {
    const suggestions = suggestMatches(
      [charge({ id: "c1" }), charge({ id: "c2", usdCents: 999999 })],
      [expense()],
      0.65,
    );
    expect(suggestions).toHaveLength(2);
    expect(suggestions[1].expenseId).toBeNull();
    expect(suggestions[1].score).toBe(0);
  });
});
