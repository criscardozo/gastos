import { describe, expect, it } from "vitest";

import { taxLines, totalArsCents, usdToArsCents } from "./card-taxes";

/**
 * Checked against Cristian's real BBVA statement (closing 2026-08-27), because
 * the only way to know these numbers are right is to reproduce ones the bank
 * already printed. Every line below is on that statement, to the cent.
 *
 *   Consumos          UBER 34,33 · TEMU 342,43 · KMART 122,52
 *                     DiDi 17,18 · DiDi 15,03        US$ 531,49
 *   COMISION CUENTA FULL                            $  40.413,22
 *   DB IVA $ 21%                                    $   8.486,78
 *   IIBB PERCEP-CABA 2,00%( 48765,94 )              $     975,31
 *   IVA RG 4240 21%( 48765,94 )                     $  10.240,84
 *   DB.RG 5617 30% ( 804675,86 )                    $ 241.402,75
 *   SALDO ACTUAL                                    $ 301.518,90
 *
 * The two DiDi rides are the digital ones: 17,18 + 15,03 = 32,21, and
 * 32,21 × 1514 = 48.765,94 exactly — the base the statement prints for IIBB and
 * RG 4240. The rate falls out of the other base the same way: 804.675,86 /
 * 531,49 = 1514,00.
 */
const RATE = 1514;
const STATEMENT = {
  usdCents: 53149,
  digitalUsdCents: 3221,
  commissionArsCents: 4041322,
  ivaArsCents: 848678,
  iibbArsCents: 97531,
  rg4240ArsCents: 1024084,
  rg5617ArsCents: 24140275,
  /** The peso balance the statement closed on. */
  saldoArsCents: 30151890,
};

const lineFor = (label: string, spend = STATEMENT) =>
  taxLines(
    { usdCents: spend.usdCents, digitalUsdCents: spend.digitalUsdCents },
    RATE,
    { commissionArsCents: STATEMENT.commissionArsCents },
  ).find((line) => line.label.startsWith(label));

describe("against the real statement", () => {
  it("reproduces every line to the cent", () => {
    // No tolerance anywhere: the percepciones truncate and the fee's IVA
    // rounds, and applying that lands exactly on what the bank charged. A
    // tolerance here would hide the day that stops being true.
    expect(lineFor("Comisión")?.arsCents).toBe(STATEMENT.commissionArsCents);
    expect(lineFor("DB IVA")?.arsCents).toBe(STATEMENT.ivaArsCents);
    expect(lineFor("IIBB")?.arsCents).toBe(STATEMENT.iibbArsCents);
    expect(lineFor("IVA RG 4240")?.arsCents).toBe(STATEMENT.rg4240ArsCents);
    expect(lineFor("DB.RG")?.arsCents).toBe(STATEMENT.rg5617ArsCents);
  });

  it("adds up to the balance the statement closed on", () => {
    // The rest of the peso side cancels out: the payment clears the previous
    // balance, and DEVOLUCION DE SALDOS clears the CR.RG 5617 refund. What is
    // left is these five lines, and they are the whole bill.
    const lines = taxLines(
      { usdCents: STATEMENT.usdCents, digitalUsdCents: STATEMENT.digitalUsdCents },
      RATE,
      { commissionArsCents: STATEMENT.commissionArsCents },
    );
    expect(totalArsCents(lines)).toBe(STATEMENT.saldoArsCents);
  });

  it("prints the bases the statement prints", () => {
    expect(usdToArsCents(STATEMENT.usdCents, RATE)).toBe(80467586);
    expect(usdToArsCents(STATEMENT.digitalUsdCents, RATE)).toBe(4876594);
  });

  it("taxes only the digital part with IIBB and RG 4240", () => {
    // The heart of it. Uber, Temu and Kmart are 499,28 of the 531,49 and the
    // bank charged them neither line — so taxing the whole spend would have
    // overstated those two by fifteen times.
    const wholeSpendTaxed = taxLines(
      { usdCents: STATEMENT.usdCents, digitalUsdCents: STATEMENT.usdCents },
      RATE,
      { commissionArsCents: 0 },
    );
    const iibb = wholeSpendTaxed.find((l) => l.label.startsWith("IIBB"));
    expect(iibb?.arsCents).toBeGreaterThan(STATEMENT.iibbArsCents * 15);
  });
});

describe("taxLines", () => {
  const noSpend = { usdCents: 0, digitalUsdCents: 0 };

  it("says nothing on an empty statement rather than five zeroes", () => {
    expect(taxLines(noSpend, RATE, { commissionArsCents: 0 })).toEqual([]);
  });

  it("charges the fee even with nothing spent — it is monthly, not per purchase", () => {
    const lines = taxLines(noSpend, RATE, { commissionArsCents: 4041322 });
    expect(lines.map((l) => l.label)).toEqual([
      "Comisión Cuenta Full",
      "DB IVA 21%",
    ]);
  });

  it("leaves IIBB and RG 4240 out of a month with nothing digital in it", () => {
    // A statement of nothing but a Kmart run: RG 5617 still applies, because it
    // taxes all foreign spend, and the other two do not exist.
    const lines = taxLines(
      { usdCents: 12252, digitalUsdCents: 0 },
      RATE,
      { commissionArsCents: 0 },
    );
    expect(lines.map((l) => l.label)).toEqual(["DB.RG 5617 30%"]);
  });

  it("keeps the statement's own order", () => {
    const lines = taxLines(
      { usdCents: 53149, digitalUsdCents: 3221 },
      RATE,
      { commissionArsCents: 4041322 },
    );
    expect(lines.map((l) => l.label)).toEqual([
      "Comisión Cuenta Full",
      "DB IVA 21%",
      "IIBB PERCEP-CABA 2%",
      "IVA RG 4240 21%",
      "DB.RG 5617 30%",
    ]);
  });

  it("truncates the percepciones and rounds the fee's IVA", () => {
    // Pinned on its own, because it is the one rule here that was derived from
    // a statement rather than from a percentage: 100 × 21% is 21,00 either way,
    // so the cases that tell them apart need choosing deliberately.
    //
    // US$ 1,01 at 1000 is $1.010,00 exactly; 2% of it is 20,20 and 21% 212,10 —
    // no fractions. US$ 1,007 cannot be typed, so the fraction has to come from
    // the rate: at 1000,49 the base is 1.010,49 (rounded from 1.010,4949), 2%
    // of which is 20,2098 → 20,20 truncated, not 20,21.
    const [iibb] = taxLines(
      { usdCents: 0, digitalUsdCents: 101 },
      1000.49,
      { commissionArsCents: 0 },
    );
    expect(iibb.arsCents).toBe(2020);

    // 3 cents of fee: 21% is 0,63 exactly. 5 cents: 1,05. 7 cents: 1,47.
    // 1 cent: 0,21. None fractional — so use one that is: 11 cents → 2,31; and
    // 4.041.322 → 848.677,62, which rounds UP to 848.678 as the bank did.
    const iva = taxLines(noSpend, RATE, { commissionArsCents: 4041322 })[1];
    expect(iva.arsCents).toBe(848678);
  });

  it("explains where each number came from", () => {
    // The basis line answers "why is this number" without a calculator, which
    // is the whole reason a statement prints its bases too.
    expect(lineFor("IIBB")?.basis).toBe("2% de $ 48.765,94");
    expect(lineFor("DB.RG")?.basis).toBe("30% de $ 804.675,86");
  });
});

describe("usdToArsCents", () => {
  it("converts integer cents to integer cents", () => {
    expect(usdToArsCents(53149, RATE)).toBe(80467586);
    expect(usdToArsCents(100, RATE)).toBe(151400);
    expect(usdToArsCents(0, RATE)).toBe(0);
  });

  it("rounds rather than truncating", () => {
    // 1,005 USD at 1000 is 1005 pesos exactly; 1,00 at 1000,5 is 1000,50,
    // which must land on a whole cent instead of a fraction reaching the UI.
    expect(usdToArsCents(100, 1000.5)).toBe(100050);
    expect(Number.isInteger(usdToArsCents(12345, 1499.37))).toBe(true);
  });
});
