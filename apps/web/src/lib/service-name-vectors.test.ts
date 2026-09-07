import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/service-name-vectors.json";
import { nameKey } from "./services";

/**
 * The fold that links a service to its charge, held to the shared vectors.
 *
 * It exists twice — here and in `ServiceLogic.nameKey` — and the two are not
 * the same code: this one strips combining marks after NFD, Swift asks
 * Foundation for a diacritic- and case-insensitive folding. Same file, both
 * sides, like the period arithmetic and the bank matcher.
 *
 * This matters more since a recurring rule can file under a service's name: a
 * rule written on the phone has to link on the web and back, and a fold that
 * drifted would break that in the quiet way — the expense filed and correct,
 * the service still saying it was never charged.
 */
describe("the service-name fold, against the shared vectors", () => {
  it("has vectors to check", () => {
    expect(vectors.sameKey.length).toBeGreaterThan(3);
    expect(vectors.differentKey.length).toBeGreaterThan(2);
  });

  it.each(vectors.sameKey)("$a = $b ($why)", ({ a, b }) => {
    expect(nameKey(a)).toBe(nameKey(b));
  });

  it.each(vectors.differentKey)("$a ≠ $b ($why)", ({ a, b }) => {
    expect(nameKey(a)).not.toBe(nameKey(b));
  });
});
