import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/recurring-vectors.json";
import {
  claimCharges,
  matchesPattern,
  ruleForCharge,
  type RecurringRule,
} from "./recurring";

/**
 * The shared vectors, run against the TypeScript matcher. The Swift one runs
 * the same file — this is the contract, not a TS test that happens to exist.
 */

function rule(over: Partial<RecurringRule> & { pattern: string }): RecurringRule {
  return {
    id: over.pattern,
    categoryId: "transport",
    note: "Opal",
    amountAudCents: 1500,
    ...over,
  };
}

describe("recurring vectors", () => {
  it("runs every group in the file", () => {
    expect(
      Object.keys(vectors).filter((k) => k !== "version" && k !== "comment"),
    ).toEqual(["matches", "firstMatch"]);
  });

  it("runs the number of cases the suite thinks it does", () => {
    expect(vectors.matches.cases.length + vectors.firstMatch.cases.length).toBe(
      22,
    );
  });
});

describe("matchesPattern", () => {
  it.each(vectors.matches.cases)("$name", ({ pattern, merchant, expected }) => {
    expect(matchesPattern(pattern, merchant)).toBe(expected);
  });
});

describe("ruleForCharge", () => {
  it.each(vectors.firstMatch.cases)("$name", ({ patterns, merchant, expected }) => {
    const chosen = ruleForCharge(
      patterns.map((p) => rule({ pattern: p })),
      merchant,
    );
    expect(chosen?.pattern ?? null).toBe(expected);
  });
});

describe("claimCharges", () => {
  const charges = [
    { id: "c1", merchant: "OPAL AUCKLAND ST" },
    { id: "c2", merchant: "COLES 0831" },
    { id: "c3", merchant: "CAFE MARTINEZ" },
  ];

  it("splits what a rule can answer from what needs asking", () => {
    const out = claimCharges(charges, [
      rule({ pattern: "Opal", amountAudCents: 1500 }),
      rule({ pattern: "Cafe", amountAudCents: null }),
    ]);
    expect(out.ready.map((c) => c.charge.id)).toEqual(["c1"]);
    expect(out.asking.map((c) => c.charge.id)).toEqual(["c3"]);
  });

  it("leaves a charge no rule claims alone", () => {
    // The whole point: an unclaimed charge stays in the pending list exactly
    // as it is today. A rule that fires on everything would be the worst
    // possible bug here, so this is the assertion that says it does not.
    const out = claimCharges(charges, [rule({ pattern: "Opal" })]);
    expect([...out.ready, ...out.asking].map((c) => c.charge.id)).toEqual(["c1"]);
  });

  it("claims nothing when there are no rules", () => {
    const out = claimCharges(charges, []);
    expect(out.ready).toEqual([]);
    expect(out.asking).toEqual([]);
  });

  it("gives a charge to the more specific rule, not to both", () => {
    const out = claimCharges([charges[0]], [
      rule({ pattern: "Opal", amountAudCents: null }),
      rule({ pattern: "OPAL AUCKLAND", amountAudCents: 1500 }),
    ]);
    expect(out.ready.map((c) => c.rule.pattern)).toEqual(["OPAL AUCKLAND"]);
    expect(out.asking).toEqual([]);
  });
});
