import { describe, expect, it } from "vitest";

import {
  DISMISS_WINDOW_HOURS,
  isExpired,
  isPending,
  isRecoverable,
  partitionCharges,
} from "./bank-charges";

const NOW = new Date("2026-08-14T10:00:00Z");

/** `hours` before NOW. */
function ago(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function charge(id: string, dismissedAt: Date | null) {
  return { id, dismissedAt };
}

describe("the window", () => {
  it("is the 48 hours both clients agree on", () => {
    // The Swift twin hard-codes the same number; if this changes, that does.
    expect(DISMISS_WINDOW_HOURS).toBe(48);
  });
});

describe("isPending", () => {
  it("is what never got dismissed", () => {
    expect(isPending(charge("a", null))).toBe(true);
    expect(isPending(charge("a", ago(1)))).toBe(false);
  });
});

describe("isExpired / isRecoverable", () => {
  it("keeps a fresh dismissal recoverable", () => {
    const c = charge("a", ago(1));
    expect(isRecoverable(c, NOW)).toBe(true);
    expect(isExpired(c, NOW)).toBe(false);
  });

  it("drops one past the window", () => {
    const c = charge("a", ago(49));
    expect(isRecoverable(c, NOW)).toBe(false);
    expect(isExpired(c, NOW)).toBe(true);
  });

  it("treats exactly 48 hours as expired, so the promise stays literal", () => {
    expect(isExpired(charge("a", ago(48)), NOW)).toBe(true);
    // One minute inside it is still there.
    expect(isRecoverable(charge("a", ago(47.98)), NOW)).toBe(true);
  });

  it("says neither about a pending charge", () => {
    // A charge that was never dismissed is not "expired" — the sweep must not
    // touch it, which is the whole reason this returns false rather than true.
    const c = charge("a", null);
    expect(isExpired(c, NOW)).toBe(false);
    expect(isRecoverable(c, NOW)).toBe(false);
  });

  it("does not expire a stamp from the future", () => {
    // Clock skew between the server stamp and this device: err towards keeping
    // the charge, never towards deleting something recoverable.
    expect(isExpired(charge("a", ago(-2)), NOW)).toBe(false);
  });
});

describe("partitionCharges", () => {
  it("splits the three states and loses nothing", () => {
    const charges = [
      charge("pending", null),
      charge("fresh", ago(2)),
      charge("stale", ago(72)),
      charge("edge", ago(47)),
    ];
    const { pending, dismissed, expired } = partitionCharges(charges, NOW);

    expect(pending.map((c) => c.id)).toEqual(["pending"]);
    expect(dismissed.map((c) => c.id)).toEqual(["fresh", "edge"]);
    expect(expired.map((c) => c.id)).toEqual(["stale"]);
    expect(pending.length + dismissed.length + expired.length).toBe(
      charges.length,
    );
  });

  it("puts the newest dismissal first — the likeliest slip is on top", () => {
    const { dismissed } = partitionCharges(
      [charge("old", ago(40)), charge("new", ago(1)), charge("mid", ago(20))],
      NOW,
    );
    expect(dismissed.map((c) => c.id)).toEqual(["new", "mid", "old"]);
  });

  it("is empty everywhere when there are no charges", () => {
    expect(partitionCharges([], NOW)).toEqual({
      pending: [],
      dismissed: [],
      expired: [],
    });
  });
});
