import { describe, expect, it } from "vitest";

import { alreadyThere, type DedupeRow } from "./import-dedupe";

// Re-importing the same file used to create every expense a second time; the
// screen could only warn about it. A row now counts as already there when an
// expense with the same date, amount, category and note exists — one existing
// expense answering for one row, so two identical coffees in the file against
// one in the ledger still import the second.
const row = (over: Partial<DedupeRow> = {}): DedupeRow => ({
  date: "2026-10-01",
  amountCents: 450,
  categoryId: "cafe",
  note: "Flat white",
  ...over,
});

describe("alreadyThere", () => {
  it("marks a row that matches an existing expense", () => {
    expect(alreadyThere([row()], [row()])).toEqual(new Set([0]));
  });

  it("ignores case, accents and surrounding space in the note", () => {
    expect(
      alreadyThere([row({ note: "  café " })], [row({ note: "Cafe" })]),
    ).toEqual(new Set([0]));
  });

  it("a different amount, date or category is a different expense", () => {
    const existing = [row()];
    expect(alreadyThere([row({ amountCents: 451 })], existing).size).toBe(0);
    expect(alreadyThere([row({ date: "2026-10-02" })], existing).size).toBe(0);
    expect(alreadyThere([row({ categoryId: "groceries" })], existing).size).toBe(0);
  });

  it("one existing expense answers for one row only", () => {
    expect(alreadyThere([row(), row()], [row()])).toEqual(new Set([0]));
  });

  it("re-importing a whole file finds every row", () => {
    const file = [row(), row(), row({ note: "Coles", amountCents: 6390 })];
    expect(alreadyThere(file, file)).toEqual(new Set([0, 1, 2]));
  });
});
