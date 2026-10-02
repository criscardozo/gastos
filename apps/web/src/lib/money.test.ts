import { describe, expect, it } from "vitest";

import {
  centsToInput,
  formatArs,
  formatRate,
  formatCents,
  formatCentsCompact,
  formatUsd,
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
  // One rule in both languages since 2026-10-02 (Cristian's call): the point
  // is the decimal mark and nothing groups thousands. A comma is still read,
  // the way the app wrote amounts until then: as a decimal when it does not
  // group three digits, and as grouping when it does.
  for (const locale of ["es", "en"] as const) {
    it(`${locale}: reads a point as the decimal mark`, () => {
      expect(parseAmountToCents("12.50", locale)).toBe(1250);
      expect(parseAmountToCents("1050.00", locale)).toBe(105000);
      expect(parseAmountToCents("1.5", locale)).toBe(150);
      expect(parseAmountToCents("900", locale)).toBe(90000);
      expect(parseAmountToCents("$42.80", locale)).toBe(4280);
    });

    it(`${locale}: still reads the comma a hand used to type`, () => {
      expect(parseAmountToCents("12,50", locale)).toBe(1250);
      expect(parseAmountToCents("1,050", locale)).toBe(105000);
      expect(parseAmountToCents("1,050.00", locale)).toBe(105000);
      expect(parseAmountToCents("99,999.99", locale)).toBe(9999999);
    });

    it(`${locale}: rejects an amount the security rules would refuse anyway`, () => {
      expect(parseAmountToCents("100000", locale)).toBe(MAX_AMOUNT_CENTS);
      expect(parseAmountToCents("100000.01", locale)).toBeNull();
      expect(parseAmountToCents("1,234,567.89", locale)).toBeNull();
    });

    it(`${locale}: rejects what is not a positive amount`, () => {
      expect(parseAmountToCents("", locale)).toBeNull();
      expect(parseAmountToCents("0", locale)).toBeNull();
      expect(parseAmountToCents("-5", locale)).toBeNull();
      expect(parseAmountToCents("abc", locale)).toBeNull();
      expect(parseAmountToCents("1,2,3", locale)).toBeNull();
      expect(parseAmountToCents("1.2.3", locale)).toBeNull();
    });
  }
});

describe("what the app prints", () => {
  // Written out by hand rather than worked out by the formatter under test.
  for (const locale of ["es", "en"] as const) {
    it(`${locale}: a point for decimals, nothing for thousands`, () => {
      expect(formatCents(105000, "AUD", locale)).toBe("$1050.00");
      expect(formatCents(4280, "AUD", locale)).toBe("$42.80");
      expect(formatCentsCompact(90000, "AUD", locale)).toBe("$900");
      expect(formatCentsCompact(123456, "AUD", locale)).toBe("$1234.56");
      expect(formatUsd(18690, locale)).toBe("US$ 186.90");
      expect(formatUsd(123456, locale)).toBe("US$ 1234.56");
    });
  }
  it("pesos too, whatever the language", () => {
    expect(formatArs(24140275)).toBe("$ 241402.75");
  });
});

describe("formatRate", () => {
  // The learned USD→AUD rate beside a pre-filled amount. It was
  // `toFixed(4).replace(".", ",")`, a comma in every language.
  it("uses the locale's decimal mark", () => {
    expect(formatRate(0.65, "es")).toBe("0.6500");
    expect(formatRate(0.65, "en")).toBe("0.6500");
  });
  it("keeps four places however many the rate has", () => {
    expect(formatRate(1.234567, "en")).toBe("1.2346");
    expect(formatRate(2, "es")).toBe("2.0000");
    expect(formatRate(0.6521, "es", 3)).toBe("0.652");
    expect(formatRate(1500, "es", 2, 0)).toBe("1500");
    expect(formatRate(1500.5, "es", 2, 0)).toBe("1500.5");
  });
});

describe("centsToInput", () => {
  // An editable prefill. The card dialogs wrote `(cents / 100).toFixed(2)`,
  // a point in Spanish too, beside a placeholder of "0,00".
  it("uses the locale's marks", () => {
    expect(centsToInput(6390, "es")).toBe("63.90");
    expect(centsToInput(6390, "en")).toBe("63.90");
    expect(centsToInput(123456, "es")).toBe("1234.56");
  });
  it("is empty for nothing", () => {
    expect(centsToInput(null, "es")).toBe("");
  });
  it("reads back as the same cents", () => {
    for (const cents of [1, 6390, 123456, 987654321]) {
      for (const locale of ["es", "en"]) {
        expect(parseAmountToCents(centsToInput(cents, locale), locale, Infinity)).toBe(cents);
      }
    }
  });
});
