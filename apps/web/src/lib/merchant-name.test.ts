import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/merchant-name-vectors.json";
import { displayMerchant } from "./merchant-name";

/**
 * The merchant display form, against the shared vectors — the Swift side,
 * `MerchantName.display`, runs the same file. One test that walks the list, so
 * an emptied or renamed section fails instead of producing no tests.
 */
describe("displayMerchant (shared vectors)", () => {
  it("gives every case its display form, and there are cases to give", () => {
    expect(vectors.cases.length).toBeGreaterThan(10);
    const wrong = vectors.cases
      .filter((c) => displayMerchant(c.raw) !== c.display)
      .map((c) => `${JSON.stringify(c.raw)} → ${JSON.stringify(displayMerchant(c.raw))}, expected ${JSON.stringify(c.display)} (${c.why})`);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });
});
