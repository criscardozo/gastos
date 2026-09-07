import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FIRESTORE_IN_LIMIT, MAX_CATEGORIES } from "./categories";

/**
 * The category cap is not a product decision — it is Firestore's `in` limit.
 * The budget total for a past period is one SUM aggregation filtered by
 * `categoryId in [...budgeted ids]`, so a household with more budgeted
 * categories than `in` accepts would break that query and nothing else. These
 * tests exist so raising the cap somewhere fails here rather than in the app.
 */
describe("category cap", () => {
  it("never exceeds what a Firestore `in` filter accepts", () => {
    expect(MAX_CATEGORIES).toBeLessThanOrEqual(FIRESTORE_IN_LIMIT);
  });

  it("matches the number the security rules enforce", () => {
    // The rules are the actual boundary: a client cap they disagree with is
    // either a lie in the UI or a query nobody can run.
    const rules = readFileSync(
      join(import.meta.dirname, "../../../../firebase/firestore.rules"),
      "utf8",
    );
    const match = rules.match(/data\.categories\.size\(\) <= (\d+)/);
    expect(match, "categories size cap not found in firestore.rules").not.toBeNull();
    expect(Number(match![1])).toBe(MAX_CATEGORIES);
  });

  it("matches the number the iOS app enforces", () => {
    // Same cap, third copy: Swift has no way to import the constant above.
    const swift = readFileSync(
      join(import.meta.dirname, "../../../ios/Gastos/Core/Models.swift"),
      "utf8",
    );
    const match = swift.match(/static let maxCategories = (\d+)/);
    expect(match, "maxCategories not found in Models.swift").not.toBeNull();
    expect(Number(match![1])).toBe(MAX_CATEGORIES);
  });
});
