import { describe, expect, it } from "vitest";

import { canAddExpense, periodDeferred } from "./period-gate";

describe("whether an expense can be added", () => {
  const period = { startDate: "2026-09-10", confirmed: false };

  it("is refused after choosing to look without starting", () => {
    const waiting = { currentPeriod: period, deferredStart: "2026-09-10" };
    expect(periodDeferred(waiting)).toBe(true);
    expect(canAddExpense(waiting)).toBe(false);
  });

  it("is allowed when nobody deferred anything", () => {
    expect(canAddExpense({ currentPeriod: period, deferredStart: null })).toBe(
      true,
    );
  });

  it("is allowed in a household that has just onboarded", () => {
    // The case that made the first version of this wrong. A fresh household's
    // period IS unconfirmed — it is materialized lazily and the prompt is
    // suppressed by the per-device ack, not by a confirmation — so a rule
    // keyed on `confirmed` locked every new household out of its first
    // expense. Five e2e tests failed on it.
    expect(canAddExpense({ currentPeriod: period, deferredStart: null })).toBe(
      true,
    );
  });

  it("stops applying once the period rolls over", () => {
    // Deferring September does not block October: the deferral names the
    // period it was about, so it expires by itself.
    const october = { startDate: "2026-10-08", confirmed: false };
    expect(
      canAddExpense({ currentPeriod: october, deferredStart: "2026-09-10" }),
    ).toBe(true);
  });

  it("stops applying the moment the period is answered", () => {
    // The deferral is in-memory and answering the screen does not clear it,
    // so without this the block outlived the decision: you started the period
    // and the app still refused the expense.
    const answered = { startDate: "2026-09-10", confirmed: true };
    expect(
      canAddExpense({ currentPeriod: answered, deferredStart: "2026-09-10" }),
    ).toBe(true);
  });

  it("is allowed when no period is materialized at all", () => {
    expect(canAddExpense({ currentPeriod: null, deferredStart: "x" })).toBe(true);
  });
});
