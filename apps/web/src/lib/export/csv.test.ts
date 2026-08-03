import { describe, expect, it } from "vitest";

import { buildExpensesCsv, CSV_HEADER, parseCsv, type CsvExpenseRow } from "./csv";

const CTX = {
  categories: [{ id: "groceries", label: "Súper" }],
  members: { u1: "Cristian" },
  deletedLabel: "Categoría eliminada",
};

function row(over: Partial<CsvExpenseRow> = {}): CsvExpenseRow {
  return {
    date: "2026-08-01",
    categoryId: "groceries",
    note: "Coles",
    amountCents: 6390,
    createdBy: "u1",
    usdCents: null,
    verified: false,
    ...over,
  };
}

describe("buildExpensesCsv", () => {
  it("writes the canonical header", () => {
    const text = buildExpensesCsv([], CTX);
    expect(text.replace(/^﻿/, "")).toBe(CSV_HEADER.join(","));
  });

  it("leaves monto_usd empty and verificado 'no' for an unverified expense", () => {
    const [, line] = buildExpensesCsv([row()], CTX).split("\r\n");
    expect(line).toBe("2026-08-01,Súper,Coles,63.90,,no,Cristian");
  });

  it("writes the bank's USD (dot-decimal) and verificado 'si' once verified", () => {
    const [, line] = buildExpensesCsv(
      [row({ usdCents: 4152, verified: true })],
      CTX,
    ).split("\r\n");
    expect(line).toBe("2026-08-01,Súper,Coles,63.90,41.52,si,Cristian");
  });

  it("never claims verified without the figure that verifies it", () => {
    // Defensive: a `verified` flag with no usdCents must not export as "si",
    // because the USD cell it refers to would be blank.
    const [, line] = buildExpensesCsv([row({ verified: true })], CTX).split(
      "\r\n",
    );
    expect(line.endsWith(",63.90,,no,Cristian")).toBe(true);
  });

  it("round-trips through parseCsv with the USD column intact", () => {
    const text = buildExpensesCsv(
      [row({ usdCents: 4152, verified: true }), row({ note: 'Con "coma", ok' })],
      CTX,
    );
    const grid = parseCsv(text);
    expect(grid[0]).toEqual([...CSV_HEADER]);
    expect(grid[1][4]).toBe("41.52");
    expect(grid[2][2]).toBe('Con "coma", ok');
    expect(grid[2][4]).toBe("");
  });

  it("falls back to the deleted-category label", () => {
    const [, line] = buildExpensesCsv([row({ categoryId: "gone" })], CTX).split(
      "\r\n",
    );
    expect(line).toContain("Categoría eliminada");
  });
});
