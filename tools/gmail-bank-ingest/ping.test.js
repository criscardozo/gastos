import { describe, expect, it } from "vitest";

import { REQUEST_WINDOW_MS, isRequestFresh } from "./ping.js";

/**
 * The gate on the manual trigger. Everything about the button's safety comes
 * down to this: a ping without a recent stamp must do no work.
 */
describe("isRequestFresh", () => {
  const now = new Date("2026-08-25T10:00:00Z");
  const ago = (ms) => new Date(now.getTime() - ms);

  it("accepts a stamp from just now", () => {
    expect(isRequestFresh(now, now)).toBe(true);
    expect(isRequestFresh(ago(1000), now)).toBe(true);
  });

  it("accepts up to the edge of the window and not past it", () => {
    expect(isRequestFresh(ago(REQUEST_WINDOW_MS), now)).toBe(true);
    expect(isRequestFresh(ago(REQUEST_WINDOW_MS + 1), now)).toBe(false);
  });

  it("refuses a stale stamp, which is what makes the URL safe to be public", () => {
    // Somebody poking the endpoint hours later gets nothing done.
    expect(isRequestFresh(ago(60 * 60 * 1000), now)).toBe(false);
  });

  it("refuses a household that was never stamped", () => {
    expect(isRequestFresh(null, now)).toBe(false);
    expect(isRequestFresh(undefined, now)).toBe(false);
  });

  it("refuses a stamp from the future instead of trusting it", () => {
    // The rules require the server's clock, so a future stamp means something
    // is wrong — and treating it as fresh would hold the window open forever.
    expect(isRequestFresh(new Date(now.getTime() + 1000), now)).toBe(false);
    expect(isRequestFresh(new Date("2030-01-01T00:00:00Z"), now)).toBe(false);
  });
});
