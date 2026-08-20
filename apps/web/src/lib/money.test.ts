import { describe, expect, it } from "vitest";

import {
  formatCents,
  formatCentsCompact,
  MAX_AMOUNT_CENTS,
  parseAmountToCents,
} from "./money";

/**
 * The test that was missing: the app must be able to re-read its own output.
 *
 * Before the parser knew about locales it could not. In en-AU it read the
 * "$1,050.00" it had just printed as 105 cents, and in es-AR it read "1.050"
 * — the ordinary way to write a thousand and fifty here — the same way. Every
 * screen that takes an amount went through it, so the ledger could take a
 * figure a thousand times too small without a word.
 */
describe("parseAmountToCents round-trips what the app prints", () => {
  // Every value here is under MAX_AMOUNT_CENTS, which the parser enforces.
  const amounts = [1, 99, 1250, 90000, 105000, 999999, 9999999];

  for (const locale of ["es", "en"] as const) {
    for (const cents of amounts) {
      it(`${locale}: ${cents} through formatCents`, () => {
        expect(parseAmountToCents(formatCents(cents, "AUD", locale), locale)).toBe(cents);
      });
    }

    // The compact form drops the decimals, so it only round-trips whole units.
    for (const cents of [1250, 90000, 105000]) {
      const whole = Math.round(cents / 100) * 100;
      it(`${locale}: ${whole} through formatCentsCompact`, () => {
        expect(
          parseAmountToCents(formatCentsCompact(whole, "AUD", locale), locale),
        ).toBe(whole);
      });
    }
  }
});

describe("parseAmountToCents on what a person types", () => {
  it("reads Spanish grouping and decimals", () => {
    expect(parseAmountToCents("12,50", "es")).toBe(1250);
    expect(parseAmountToCents("1.050", "es")).toBe(105000);
    expect(parseAmountToCents("1.050,00", "es")).toBe(105000);
    expect(parseAmountToCents("99.999,99", "es")).toBe(9999999);
    // Two grouping marks parse fine and are then refused by the ceiling — with
    // a $100.000 cap nobody can type an amount that has two of them.
    expect(parseAmountToCents("1.234.567,89", "es")).toBeNull();
    expect(parseAmountToCents("900", "es")).toBe(90000);
    expect(parseAmountToCents("$42,80", "es")).toBe(4280);
  });

  it("reads English grouping and decimals", () => {
    expect(parseAmountToCents("12.50", "en")).toBe(1250);
    expect(parseAmountToCents("1,050", "en")).toBe(105000);
    expect(parseAmountToCents("1,050.00", "en")).toBe(105000);
    expect(parseAmountToCents("99,999.99", "en")).toBe(9999999);
    expect(parseAmountToCents("1,234,567.89", "en")).toBeNull();  // ceiling
  });

  it("treats a lone mark that does not group as a decimal point", () => {
    // Nobody typing "12.50" in Spanish means twelve hundred fifty, and nobody
    // typing "1.5" means fifteen hundredths of a peso.
    expect(parseAmountToCents("12.50", "es")).toBe(1250);
    expect(parseAmountToCents("1.5", "es")).toBe(150);
    expect(parseAmountToCents("12,50", "en")).toBe(1250);
  });

  it("rejects an amount the security rules would refuse anyway", () => {
    // The ceiling used to be checked only by the CSV importer, so the entry
    // form let $200.000 through to be refused by the server.
    expect(parseAmountToCents("100000", "es")).toBe(MAX_AMOUNT_CENTS);
    expect(parseAmountToCents("100000,01", "es")).toBeNull();
    expect(parseAmountToCents("999999", "es")).toBeNull();
  });

  it("rejects what is not a positive amount", () => {
    expect(parseAmountToCents("", "es")).toBeNull();
    expect(parseAmountToCents("0", "es")).toBeNull();
    expect(parseAmountToCents("-5", "es")).toBeNull();
    expect(parseAmountToCents("abc", "es")).toBeNull();
    expect(parseAmountToCents("1,2,3", "en")).toBeNull();
  });
});
