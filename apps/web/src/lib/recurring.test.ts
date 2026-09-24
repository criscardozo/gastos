import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/recurring-vectors.json";
import {
  claimCharges,
  estimateAudCents,
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
      // `run` is read by recurring-run.test.ts, the planner's own suite.
    ).toEqual(["matches", "firstMatch", "estimate", "run"]);
  });

  it("runs the number of cases the suite thinks it does", () => {
    expect(
      vectors.matches.cases.length +
        vectors.firstMatch.cases.length +
        vectors.estimate.cases.length,
    ).toBe(30);
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
    { id: "c1", merchant: "OPAL AUCKLAND ST", usdCents: 975 },
    { id: "c2", merchant: "COLES 0831", usdCents: 4552 },
    { id: "c3", merchant: "CAFE MARTINEZ", usdCents: 520 },
  ];
  /** What the household's own verified pairs reveal. */
  const RATE = 0.65;

  it("splits what a rule can answer from what needs asking", () => {
    // With a rate learned, BOTH can be filed — the second on an estimate.
    const out = claimCharges(
      charges,
      [
        rule({ pattern: "Opal", amountAudCents: 1500 }),
        rule({ pattern: "Cafe", amountAudCents: null }),
      ],
      RATE,
    );
    expect(out.ready.map((c) => [c.charge.id, c.amountAudCents, c.estimated])).toEqual([
      ["c1", 1500, false],
      ["c3", 800, true],
    ]);
    expect(out.asking).toEqual([]);
  });

  it("leaves a charge no rule claims alone", () => {
    // The whole point: an unclaimed charge stays in the pending list exactly
    // as it is today. A rule that fires on everything would be the worst
    // possible bug here, so this is the assertion that says it does not.
    const out = claimCharges(charges, [rule({ pattern: "Opal" })], RATE);
    expect([...out.ready, ...out.asking].map((c) => c.charge.id)).toEqual(["c1"]);
  });

  it("claims nothing when there are no rules", () => {
    const out = claimCharges(charges, [], RATE);
    expect(out.ready).toEqual([]);
    expect(out.asking).toEqual([]);
  });

  it("gives a charge to the more specific rule, not to both", () => {
    const out = claimCharges(
      [charges[0]],
      [
        rule({ pattern: "Opal", amountAudCents: null }),
        rule({ pattern: "OPAL AUCKLAND", amountAudCents: 1500 }),
      ],
      RATE,
    );
    expect(out.ready.map((c) => c.rule.pattern)).toEqual(["OPAL AUCKLAND"]);
    expect(out.asking).toEqual([]);
  });
});

describe("estimateAudCents", () => {
  it.each(vectors.estimate.cases)("$name", ({ usdCents, rate, expected }) => {
    expect(estimateAudCents(usdCents, rate)).toBe(expected);
  });
});

describe("a rule with no amount and nothing to estimate from", () => {
  it("has to be asked about — which is only before anything is verified", () => {
    // The one case that still waits. Once a single pair has been verified the
    // rate exists and nothing waits again.
    const out = claimCharges(
      [{ id: "c1", merchant: "CAFE MARTINEZ", usdCents: 520 }],
      [rule({ pattern: "Cafe", amountAudCents: null })],
      null,
    );
    expect(out.ready).toEqual([]);
    expect(out.asking.map((c) => [c.charge.id, c.amountAudCents])).toEqual([
      ["c1", null],
    ]);
  });
});
