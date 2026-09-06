import { describe, expect, it } from "vitest";

import type { Expense } from "./firebase/converters";
import { NO_FILTERS, visibleExpenses } from "./expense-list";

/**
 * This logic ran on the expenses screen for months with no test: it was
 * written inline in the component, so the only way to check it was to look at
 * the screen and believe it. Extracting it is what made these possible.
 */

/** `createdAt` as the converter hands it over: a Timestamp-like with toMillis. */
function at(millis: number | null) {
  // Only `toMillis` is read by the sort, so the rest of Timestamp is not
  // worth constructing — the cast says that out loud.
  return millis === null
    ? null
    : ({ toMillis: () => millis } as unknown as Expense["createdAt"]);
}

function expense(over: Partial<Expense> & { id: string }): Expense {
  return {
    date: "2026-09-05",
    amountCents: 1000,
    categoryId: "food",
    note: "",
    createdBy: "alice",
    verified: false,
    usdCents: null,
    createdAt: at(1_000),
    ...over,
  } as unknown as Expense;
}

describe("filtering", () => {
  const rows = [
    expense({ id: "a", categoryId: "food", createdBy: "alice", note: "Café" }),
    expense({ id: "b", categoryId: "fuel", createdBy: "bob", verified: true }),
  ];

  it("shows everything when nothing is filtered", () => {
    expect(visibleExpenses(rows, NO_FILTERS).rows).toHaveLength(2);
  });

  it("composes: a category AND a person, not either", () => {
    const out = visibleExpenses(rows, {
      ...NO_FILTERS,
      category: "food",
      person: "bob",
    });
    expect(out.rows).toHaveLength(0);
  });

  it("splits verified from unverified", () => {
    expect(
      visibleExpenses(rows, { ...NO_FILTERS, verification: "verified" }).rows,
    ).toEqual([rows[1]]);
    expect(
      visibleExpenses(rows, { ...NO_FILTERS, verification: "unverified" }).rows,
    ).toEqual([rows[0]]);
  });

  it("searches the note, folded and trimmed", () => {
    // Typed with different case and stray spaces, which is how it arrives.
    expect(
      visibleExpenses(rows, { ...NO_FILTERS, search: "  CAFÉ " }).rows,
    ).toEqual([rows[0]]);
  });

  it("does not search anything but the note", () => {
    // "food" is a category id, not text the user wrote.
    expect(visibleExpenses(rows, { ...NO_FILTERS, search: "food" }).rows)
      .toHaveLength(0);
  });
});

describe("ordering", () => {
  it("puts the newest DAY first", () => {
    const out = visibleExpenses(
      [
        expense({ id: "old", date: "2026-09-01" }),
        expense({ id: "new", date: "2026-09-05" }),
      ],
      NO_FILTERS,
    );
    expect(out.rows.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("breaks a tie within a day by what was created last", () => {
    const out = visibleExpenses(
      [
        expense({ id: "first", createdAt: at(1_000) }),
        expense({ id: "second", createdAt: at(2_000) }),
      ],
      NO_FILTERS,
    );
    expect(out.rows.map((e) => e.id)).toEqual(["second", "first"]);
  });

  it("floats a row that has not reached the server yet to the top", () => {
    // A pending write has no server timestamp. It belongs where you are
    // looking — you just typed it — not under everything that already landed.
    const out = visibleExpenses(
      [
        expense({ id: "landed", createdAt: at(9_000) }),
        expense({ id: "pending", createdAt: null }),
      ],
      NO_FILTERS,
    );
    expect(out.rows.map((e) => e.id)).toEqual(["pending", "landed"]);
  });
});

describe("grouping into days", () => {
  it("totals each day and keeps the day order", () => {
    const out = visibleExpenses(
      [
        expense({ id: "a", date: "2026-09-05", amountCents: 1000 }),
        expense({ id: "b", date: "2026-09-05", amountCents: 250 }),
        expense({ id: "c", date: "2026-09-04", amountCents: 700 }),
      ],
      NO_FILTERS,
    );
    expect(out.days.map((d) => [d.date, d.rows.length, d.totalCents])).toEqual([
      ["2026-09-05", 2, 1250],
      ["2026-09-04", 1, 700],
    ]);
  });

  it("never prints the same day twice, however the input arrived", () => {
    // The grouping walks consecutive runs, so it depends on the sort having
    // run first. Fed interleaved dates it would print a day twice — a bug a
    // reader would blame on the data.
    const out = visibleExpenses(
      [
        expense({ id: "a", date: "2026-09-05" }),
        expense({ id: "b", date: "2026-09-04" }),
        expense({ id: "c", date: "2026-09-05" }),
      ],
      NO_FILTERS,
    );
    expect(out.days.map((d) => d.date)).toEqual(["2026-09-05", "2026-09-04"]);
  });

  it("has nothing to group when the filters exclude everything", () => {
    const out = visibleExpenses([expense({ id: "a" })], {
      ...NO_FILTERS,
      search: "nada",
    });
    expect(out.days).toEqual([]);
  });
});
