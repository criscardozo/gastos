import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FIRESTORE_IN_LIMIT,
  MAX_CATEGORIES,
  firstCategoryId,
  isArchived,
  offeredForEntry,
} from "./categories";

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

describe("firstCategoryId", () => {
  // What a dialog preselects. It was Object.keys(...)[0] — whatever order the
  // map came back in — while the dropdown under it lists by sortOrder, so
  // the preselected category was not the first one offered. iOS takes
  // sortedCategories.first.
  it("is the first by sortOrder, not by key order", () => {
    const categories = {
      aaa: { name: "Last", icon: "tag", color: "#000000", sortOrder: 5 },
      zzz: { name: "First", icon: "tag", color: "#000000", sortOrder: 0 },
    };
    expect(Object.keys(categories)[0]).toBe("aaa");
    expect(firstCategoryId(categories)).toBe("zzz");
  });
  it("is empty for a household with none", () => {
    expect(firstCategoryId({})).toBe("");
  });
});

describe("archived categories", () => {
  // Archiving keeps a category's name, icon and colour, so its old expenses
  // still read as what they were — deleting turned them into "Categoría
  // borrada" — while it stops being offered for anything new.
  const categories = {
    food: { name: "Comida", icon: "tag", color: "#000000", sortOrder: 1 },
    gym: { name: "Gimnasio", icon: "tag", color: "#000000", sortOrder: 0, archived: true },
    rent: { name: "Alquiler", icon: "tag", color: "#000000", sortOrder: 2 },
  };

  it("is archived only when it says so", () => {
    expect(isArchived(categories.gym)).toBe(true);
    expect(isArchived(categories.food)).toBe(false);
    expect(isArchived(undefined)).toBe(false);
  });

  it("is never the one a form preselects, even sorted first", () => {
    expect(firstCategoryId(categories)).toBe("food");
  });

  it("is left out of what a form offers, by sortOrder", () => {
    expect(offeredForEntry(categories).map(([id]) => id)).toEqual(["food", "rent"]);
  });

  it("stays offered for an expense that is already in it", () => {
    // Editing an old gym expense must not silently move it elsewhere.
    expect(offeredForEntry(categories, "gym").map(([id]) => id)).toEqual([
      "gym",
      "food",
      "rent",
    ]);
  });
});
