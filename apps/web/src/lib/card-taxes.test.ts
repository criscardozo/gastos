import { describe, expect, it } from "vitest";

import { taxLines, totalArsCents, usdToArsCents } from "./card-taxes";

/**
 * Checked against Cristian's real BBVA statement (closing 2026-08-27), because
 * the only way to know these numbers are right is to reproduce ones the bank
 * already printed.
 *
 *   TOTAL CONSUMOS            US$ 531,49
 *   COMISION CUENTA FULL       $ 40.413,22
 *   DB IVA $ 21%               $  8.486,78
 *   DB.RG 5617 30% (804675,86) $ 241.402,75
 */
const STATEMENT = {
  usdCents: 53149,
  commissionArsCents: 4041322,
  ivaArsCents: 848678,
  rg5617ArsCents: 24140275,
  spendArsCents: 80467586,
};

describe("against the real statement", () => {
  it("computes the fee's IVA to the cent", () => {
    const lines = taxLines(0, 1514, {
      commissionArsCents: STATEMENT.commissionArsCents,
    });
    const iva = lines.find((l) => l.label.startsWith("DB IVA"));
    expect(iva?.arsCents).toBe(STATEMENT.ivaArsCents);
  });

  it("computes RG 5617 from the spend, to within the bank's own rounding", () => {
    // 804675,86 / 531,49 = 1514,00 — the rate implied by the statement itself,
    // so the only thing that can differ is rounding. It differs by ONE CENT:
    // 30% of the printed base is 241.402,758 and the bank charged 241.402,75.
    //
    // Not a bug to chase. The bank is inconsistent with itself across the same
    // statement — DB IVA rounds 8.486,7762 up to 8.486,78 while IIBB truncates
    // 975,3188 to 975,31 — which is what percepciones computed PER PURCHASE and
    // then summed look like, rather than one percentage of one total. Matching
    // it exactly would mean inventing a rule from a single statement; a cent on
    // 241 thousand pesos is not worth a wrong rule.
    const lines = taxLines(STATEMENT.usdCents, 1514, {
      commissionArsCents: 0,
    });
    const rg = lines.find((l) => l.label.startsWith("DB.RG"))!;
    expect(Math.abs(rg.arsCents - STATEMENT.rg5617ArsCents)).toBeLessThanOrEqual(5);
  });

  it("is within a rounding cent of the bank at the published daily rates", () => {
    // The rate above is derived from the statement, so it cannot disagree. This
    // one uses what the market actually printed those days (oficial venta,
    // argentinadatos): 10/8 1520, 13/8 1515, 17/8 1510, 18/8 1515 — weighted
    // out to 1515,16 across the five purchases. Real-world drift, not a bug.
    const lines = taxLines(STATEMENT.usdCents, 1515.16, { commissionArsCents: 0 });
    const rg = lines.find((l) => l.label.startsWith("DB.RG"))!;
    const drift = Math.abs(rg.arsCents - STATEMENT.rg5617ArsCents) / STATEMENT.rg5617ArsCents;
    expect(drift).toBeLessThan(0.001);
  });
});

describe("taxLines", () => {
  it("says nothing on an empty statement rather than three zeroes", () => {
    expect(taxLines(0, 1514, { commissionArsCents: 0 })).toEqual([]);
  });

  it("charges the fee even with nothing spent — it is monthly, not per purchase", () => {
    const lines = taxLines(0, 1514, { commissionArsCents: 4041322 });
    expect(lines.map((l) => l.label)).toEqual([
      "Comisión Cuenta Full",
      "DB IVA 21%",
    ]);
  });

  it("charges RG 5617 with no fee configured", () => {
    const lines = taxLines(53149, 1514, { commissionArsCents: 0 });
    expect(lines.map((l) => l.label)).toEqual(["DB.RG 5617 30%"]);
  });

  it("does NOT include IIBB or IVA RG 4240", () => {
    // Deliberate: their base is digital services only, which the app cannot
    // identify yet. Asserted so adding them later is a decision rather than an
    // accident, and so this absence reads as intent to whoever comes next.
    const labels = taxLines(53149, 1514, { commissionArsCents: 4041322 }).map(
      (l) => l.label,
    );
    expect(labels.some((l) => l.includes("IIBB"))).toBe(false);
    expect(labels.some((l) => l.includes("4240"))).toBe(false);
  });

  it("adds up", () => {
    const lines = taxLines(53149, 1514, { commissionArsCents: 4041322 });
    const bank =
      STATEMENT.commissionArsCents + STATEMENT.ivaArsCents + STATEMENT.rg5617ArsCents;
    // Same one-cent rounding difference as above, and no more than that.
    expect(Math.abs(totalArsCents(lines) - bank)).toBeLessThanOrEqual(5);
  });
});

describe("usdToArsCents", () => {
  it("converts integer cents to integer cents", () => {
    expect(usdToArsCents(53149, 1514)).toBe(80467586);
    expect(usdToArsCents(100, 1514)).toBe(151400);
    expect(usdToArsCents(0, 1514)).toBe(0);
  });

  it("rounds rather than truncating", () => {
    // 1,005 USD at 1000 is 1005 pesos exactly; 1,005 at 1000,5 is 1005,5025,
    // which must land on a whole cent instead of a fraction reaching the UI.
    expect(usdToArsCents(100, 1000.5)).toBe(100050);
    expect(Number.isInteger(usdToArsCents(12345, 1499.37))).toBe(true);
  });
});
