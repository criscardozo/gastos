import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/recurring-vectors.json";
import { planRecurringRun, type RecurringRule } from "./recurring";

/**
 * The `run` cases of the shared vectors, against the TypeScript planner. The
 * Swift planner runs the same cases — this is the contract that keeps the two
 * clients deciding the same thing, which they did not while each had its own.
 */

interface RunCase {
  name: string;
  pending: { id: string; merchant: string; usdCents: number }[];
  rules: { pattern: string; amountAudCents: number | null }[];
  learnedRate: number | null;
  seen: string[];
  filed: string[];
  expected: {
    fresh: string[];
    file: { charge: string; amountAudCents: number; estimated: boolean }[];
    ask: string[];
  };
}

const cases = (vectors as unknown as { run: { cases: RunCase[] } }).run.cases;

describe("planRecurringRun (shared vectors)", () => {
  it("runs every case, and there are cases to run", () => {
    // One test that walks the list, so an empty or renamed section cannot
    // pass by producing no tests.
    expect(cases.length).toBeGreaterThan(6);
    const wrong: string[] = [];
    for (const c of cases) {
      const rules: RecurringRule[] = c.rules.map((r) => ({
        id: r.pattern,
        pattern: r.pattern,
        categoryId: "transport",
        note: "n",
        amountAudCents: r.amountAudCents,
      }));
      const plan = planRecurringRun(
        c.pending,
        rules,
        c.learnedRate,
        new Set(c.seen),
        new Set(c.filed),
      );
      const got = {
        fresh: plan.fresh,
        file: plan.file.map((f) => ({
          charge: f.charge.id,
          amountAudCents: f.amountAudCents,
          estimated: f.estimated,
        })),
        ask: plan.ask.map((a) => a.charge.id),
      };
      if (JSON.stringify(got) !== JSON.stringify(c.expected)) {
        wrong.push(`${c.name}\n    got      ${JSON.stringify(got)}\n    expected ${JSON.stringify(c.expected)}`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });
});
