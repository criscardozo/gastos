import { describe, expect, it } from "vitest";
import { buildExportPayload, type ExportPayloadInput } from "./payload";
import type { Expense } from "../firebase/converters";

/**
 * The payload the PDF, the workbook and the Drive upload all render.
 *
 * It lived inside the Datos page and could only be exercised through a screen,
 * which meant the one piece of arithmetic in the export path — the per-category
 * totals — was never checked against a case. Three exports read those totals
 * and none of them recomputes, so a mistake here is wrong in all three and
 * visible in none of the code that shows it.
 */

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    date: "2026-09-10",
    categoryId: "food",
    note: "",
    amountCents: 1000,
    usdCents: null,
    createdBy: "uid-a",
    ...over,
  } as Expense;
}

function input(over: Partial<ExportPayloadInput> = {}): ExportPayloadInput {
  return {
    rows: [expense()],
    range: { startDate: "2026-09-01", endDate: "2026-09-30" },
    fileBase: "gastos-septiembre",
    extension: "pdf",
    household: { name: "Casa", currency: "AUD" },
    memberNames: { "uid-a": "Cristian" },
    catLabelOf: (id) => ({ food: "Comida", transport: "Transporte" })[id] ?? id,
    locale: "es",
    totalCents: 1000,
    totalUsdCents: 0,
    unverifiedCount: 0,
    t: (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key),
    ...over,
  };
}

describe("the export payload", () => {
  it("sums per category and orders by the biggest", () => {
    const payload = buildExportPayload(
      input({
        rows: [
          expense({ id: "a", categoryId: "food", amountCents: 500 }),
          expense({ id: "b", categoryId: "transport", amountCents: 3000 }),
          expense({ id: "c", categoryId: "food", amountCents: 700 }),
        ],
      }),
    );
    expect(payload.categoryTotals).toEqual([
      { label: "Transporte", amountCents: 3000, usdCents: 0 },
      { label: "Comida", amountCents: 1200, usdCents: 0 },
    ]);
  });

  it("adds the bank's USD separately, and treats an absent one as zero", () => {
    // Not the same as summing `usdCents ?? 0` into the AUD column: the two
    // currencies are different columns in every export, and an unverified
    // expense has no USD rather than a USD of nothing.
    const payload = buildExportPayload(
      input({
        rows: [
          expense({ id: "a", categoryId: "food", amountCents: 100, usdCents: 70 }),
          expense({ id: "b", categoryId: "food", amountCents: 200, usdCents: null }),
        ],
      }),
    );
    expect(payload.categoryTotals).toEqual([
      { label: "Comida", amountCents: 300, usdCents: 70 },
    ]);
    expect(payload.rows[1].usdCents).toBeNull();
  });

  it("keeps the rows in the order it was handed", () => {
    // The screen's order IS the export's order — that is the promise the Datos
    // page makes, and sorting here would break it silently.
    const payload = buildExportPayload(
      input({
        rows: [
          expense({ id: "a", date: "2026-09-20" }),
          expense({ id: "b", date: "2026-09-01" }),
        ],
      }),
    );
    expect(payload.rows.map((r) => r.date)).toEqual(["2026-09-20", "2026-09-01"]);
  });

  it("falls back to the uid when a member has no name", () => {
    // A member who left, or a document written before display names existed.
    // Showing a raw uid is ugly; showing nothing loses who spent it.
    const payload = buildExportPayload(
      input({ rows: [expense({ createdBy: "uid-gone" })] }),
    );
    expect(payload.rows[0].memberLabel).toBe("uid-gone");
  });

  it("names the file from the base and the extension it is asked for", () => {
    expect(buildExportPayload(input({ extension: "xlsx" })).filename).toBe(
      "gastos-septiembre.xlsx",
    );
  });

  it("carries the unverified count into the notice, not just the field", () => {
    // The count appears twice — as a number the renderer can branch on and
    // inside the sentence the reader sees. They came apart once already.
    const payload = buildExportPayload(input({ unverifiedCount: 3 }));
    expect(payload.unverifiedCount).toBe(3);
    expect(payload.labels.unverifiedNotice).toContain("3");
  });
});
