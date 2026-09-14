import { describe, expect, it } from "vitest";

import { periodSource } from "./period-source";

describe("whether a period's budget is the usual figure", () => {
  it("is the default when the amount is the household's", () => {
    // The reported case: a weekly default of $170, the carry declined, and
    // the period reading exactly $170. Nothing was adjusted.
    expect(periodSource(17000, 17000)).toBe("default");
  });

  it("is custom when a leftover was carried in", () => {
    // $900 usual plus $200 left over is $1,100, which is not the usual
    // figure — and the badge is exactly how somebody learns that this week's
    // number is not comparable to last week's.
    expect(periodSource(110000, 90000)).toBe("custom");
  });

  it("is custom when a different amount was typed", () => {
    expect(periodSource(50000, 90000)).toBe("custom");
  });

  it("does not call everything custom", () => {
    // The control: a rule that always said "custom" would pass the two above
    // and be useless.
    expect(periodSource(90000, 90000)).toBe("default");
  });
});
