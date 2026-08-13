import { describe, expect, it } from "vitest";

import {
  belongsToCard,
  belongsToExpenses,
  brandFor,
  cardRows,
  classifyCharge,
  isValidLast4,
  type HouseholdCards,
} from "./cards";

// Cristian's real pair: 2024 is the debit card, 6576 the credit one.
const CARDS: HouseholdCards = {
  "2024": { kind: "debit" },
  "6576": { kind: "credit", brand: "visa" },
};

describe("classifyCharge", () => {
  it("routes by the digits the bank printed", () => {
    expect(classifyCharge("2024", CARDS)).toBe("debit");
    expect(classifyCharge("6576", CARDS)).toBe("credit");
  });

  it("calls anything it was not told about unknown", () => {
    expect(classifyCharge("9999", CARDS)).toBe("unknown");
  });

  it("treats a missing figure and an empty one the same", () => {
    // Both mean "the email did not say", which is one situation, not two.
    expect(classifyCharge(null, CARDS)).toBe("unknown");
    expect(classifyCharge(undefined, CARDS)).toBe("unknown");
    expect(classifyCharge("", CARDS)).toBe("unknown");
  });

  it("is unknown for everything until cards are configured", () => {
    // The state every household starts in, and the one it returns to if the
    // configuration is ever cleared.
    expect(classifyCharge("2024", null)).toBe("unknown");
    expect(classifyCharge("2024", {})).toBe("unknown");
  });
});

describe("routing", () => {
  it("sends debit to the expense screens and credit to Tarjetas", () => {
    expect(belongsToExpenses("2024", CARDS)).toBe(true);
    expect(belongsToCard("2024", CARDS)).toBe(false);
    expect(belongsToCard("6576", CARDS)).toBe(true);
    expect(belongsToExpenses("6576", CARDS)).toBe(false);
  });

  it("shows an unidentified charge in BOTH, never in neither", () => {
    // The whole point: a charge nobody claims must not disappear because the
    // bank reworded its email or a new card turned up.
    for (const digits of [null, "", "9999"]) {
      expect(belongsToExpenses(digits, CARDS)).toBe(true);
      expect(belongsToCard(digits, CARDS)).toBe(true);
    }
  });

  it("shows everything in both while nothing is configured", () => {
    expect(belongsToExpenses("2024", {})).toBe(true);
    expect(belongsToCard("2024", {})).toBe(true);
  });
});

describe("brandFor", () => {
  it("prefills the configured brand", () => {
    expect(brandFor("6576", CARDS)).toBe("visa");
  });

  it("is null when there is nothing to prefill, so the user picks", () => {
    expect(brandFor("2024", CARDS)).toBeNull(); // debit carries no brand
    expect(brandFor("9999", CARDS)).toBeNull();
    expect(brandFor(null, CARDS)).toBeNull();
    expect(brandFor("6576", { "6576": { kind: "credit" } })).toBeNull();
  });
});

describe("isValidLast4", () => {
  it("takes four digits and nothing else", () => {
    expect(isValidLast4("2024")).toBe(true);
    expect(isValidLast4("0007")).toBe(true);
    expect(isValidLast4("204")).toBe(false);
    expect(isValidLast4("20244")).toBe(false);
    expect(isValidLast4("20a4")).toBe(false);
    expect(isValidLast4("")).toBe(false);
  });
});

describe("cardRows", () => {
  it("lists them in a stable order so the editor never jumps", () => {
    expect(cardRows(CARDS).map((r) => r.last4)).toEqual(["2024", "6576"]);
    expect(cardRows({ "9999": { kind: "debit" }, "1111": { kind: "credit" } })
      .map((r) => r.last4)).toEqual(["1111", "9999"]);
  });

  it("is empty, not broken, when there are none", () => {
    expect(cardRows(null)).toEqual([]);
    expect(cardRows(undefined)).toEqual([]);
  });
});
