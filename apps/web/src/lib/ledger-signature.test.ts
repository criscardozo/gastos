import { describe, expect, it } from "vitest";

import { ledgerSignature } from "./ledger-signature";

const a = { id: "a", amountCents: 1250, date: "2026-09-28", categoryId: "coffee" };
const b = { id: "b", amountCents: 4000, date: "2026-09-27", categoryId: "groceries" };

describe("ledgerSignature", () => {
  it("does not change with the order a listener delivers in", () => {
    expect(ledgerSignature([a, b])).toBe(ledgerSignature([b, a]));
  });

  it("does not change with anything the month's sum does not read", () => {
    // pendingWrite flips from true to false on the server's ack: same figures.
    expect(ledgerSignature([{ ...a, pendingWrite: true } as typeof a])).toBe(
      ledgerSignature([{ ...a, pendingWrite: false } as typeof a]),
    );
  });

  it("changes with each thing the sum does read", () => {
    const base = ledgerSignature([a, b]);
    expect(ledgerSignature([a])).not.toBe(base);
    expect(ledgerSignature([{ ...a, amountCents: 1251 }, b])).not.toBe(base);
    expect(ledgerSignature([{ ...a, date: "2026-10-01" }, b])).not.toBe(base);
    expect(ledgerSignature([{ ...a, categoryId: "other" }, b])).not.toBe(base);
  });

  it("is empty for an empty ledger", () => {
    expect(ledgerSignature([])).toBe("");
  });
});
