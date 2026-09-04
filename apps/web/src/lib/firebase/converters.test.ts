import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { QueryDocumentSnapshot } from "firebase/firestore";

import {
  bankChargeConverter,
  cardChargeConverter,
  cardStatementConverter,
  expenseConverter,
  householdConverter,
  inviteConverter,
  periodBudgetConverter,
  serviceConverter,
  userConverter,
} from "./converters";

/**
 * Decoding documents that are NOT the shape they claim.
 *
 * The security rules refuse a badly shaped write, so in theory none of this
 * can be in the database. In practice three writers get past them: the Apps
 * Script that files bank charges, the emulator seed (admin writes bypass rules
 * entirely), and older builds of either client. What these tests pin down is
 * what happens then — that a broken document is REFUSED BY NAME rather than
 * decoded into a plausible lie.
 *
 * The failure being prevented is specific: `data.amountCents as number` on a
 * missing field yields `undefined`, which formats as "$NaN" and, worse, turns
 * the period's whole total into NaN. One bad row made the budget unreadable
 * and nothing said why.
 */

/** The three things every converter touches on a snapshot, and nothing else. */
function snapshot(id: string, data: Record<string, unknown>, pending = false) {
  return {
    id,
    data: () => data,
    metadata: { hasPendingWrites: pending },
  } as unknown as QueryDocumentSnapshot;
}

const decode = <T,>(
  converter: { fromFirestore: (snap: QueryDocumentSnapshot) => T },
  id: string,
  data: Record<string, unknown>,
  pending = false,
) => converter.fromFirestore(snapshot(id, data, pending));

let errors: string[] = [];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

/** Every refusal has to say which document and why — that is the whole point. */
function expectRejected(result: unknown, path: string) {
  expect(result).toBeNull();
  expect(errors.join("\n")).toContain(path);
}

const validExpense = {
  amountCents: 1250,
  categoryId: "groceries",
  note: "Café",
  date: "2026-09-04",
  createdBy: "u1",
};

describe("expenseConverter", () => {
  it("decodes a well-formed expense", () => {
    const e = decode(expenseConverter, "e1", validExpense, true);
    expect(e).toMatchObject({
      id: "e1",
      amountCents: 1250,
      categoryId: "groceries",
      note: "Café",
      date: "2026-09-04",
      createdBy: "u1",
      usdCents: null,
      verified: false,
      pendingWrite: true,
    });
  });

  it("refuses an amount that is not a positive integer", () => {
    // The three shapes money must never take. A float is the interesting one:
    // it would round somewhere downstream and be wrong by a cent forever.
    for (const amountCents of [undefined, "1250", 12.5, 0, -5]) {
      errors = [];
      expectRejected(
        decode(expenseConverter, "e1", { ...validExpense, amountCents }),
        "expenses/e1",
      );
    }
  });

  it("refuses a date that is not a calendar date", () => {
    // "2026-9-4" sorts BEFORE "2026-10-01" as a string, so a single unpadded
    // date silently lands in the wrong period for every range query.
    for (const date of [undefined, "2026-9-4", "04/09/2026", 20260904]) {
      errors = [];
      expectRejected(
        decode(expenseConverter, "e1", { ...validExpense, date }),
        "expenses/e1",
      );
    }
  });

  it("refuses an expense with no category", () => {
    expectRejected(
      decode(expenseConverter, "e1", { ...validExpense, categoryId: undefined }),
      "expenses/e1",
    );
  });

  it("keeps an absent usdCents as null rather than zero", () => {
    // Absent means the bank has not said what it charged; zero would be a
    // claim that it charged nothing.
    const e = decode(expenseConverter, "e1", validExpense);
    expect(e?.usdCents).toBeNull();
    expect(decode(expenseConverter, "e1", { ...validExpense, usdCents: 0 })?.usdCents).toBe(0);
  });

  it("tolerates a missing note, which is optional", () => {
    const e = decode(expenseConverter, "e1", { ...validExpense, note: undefined });
    expect(e?.note).toBe("");
  });
});

const validPeriod = {
  startDate: "2026-08-28",
  endDate: "2026-09-03",
  period: "weekly",
  amountCents: 18386,
  source: "custom",
};

describe("periodBudgetConverter", () => {
  it("decodes a well-formed period", () => {
    expect(decode(periodBudgetConverter, "2026-08-28", validPeriod)).toEqual({
      startDate: "2026-08-28",
      endDate: "2026-09-03",
      period: "weekly",
      amountCents: 18386,
      source: "custom",
      rolloverCents: 0,
      confirmed: false,
    });
  });

  it("refuses boundaries that are not dates, or are the wrong way round", () => {
    for (const patch of [
      { startDate: undefined },
      { endDate: "not-a-date" },
      { endDate: "2026-08-20" }, // before the start
      { endDate: "2026-08-28" }, // same day
    ]) {
      errors = [];
      expectRejected(
        decode(periodBudgetConverter, "2026-08-28", { ...validPeriod, ...patch }),
        "periodBudgets/2026-08-28",
      );
    }
  });

  it("refuses a period type it does not know", () => {
    expectRejected(
      decode(periodBudgetConverter, "2026-08-28", { ...validPeriod, period: "monthly" }),
      "periodBudgets/2026-08-28",
    );
  });

  it("reads confirmedAt as a boolean and nothing more", () => {
    const c = decode(periodBudgetConverter, "2026-08-28", {
      ...validPeriod,
      confirmedAt: new Date(),
    });
    expect(c?.confirmed).toBe(true);
  });

  it("falls back on source rather than refusing: it explains, it does not decide", () => {
    const p = decode(periodBudgetConverter, "2026-08-28", { ...validPeriod, source: "magic" });
    expect(p?.source).toBe("default");
  });
});

const validHousehold = {
  name: "Casa",
  currency: "AUD",
  timezone: "Australia/Sydney",
  defaultBudget: { amountCents: 90000, period: "fortnightly", anchorDate: "2026-09-01" },
  memberIds: ["u1", "u2"],
};

describe("householdConverter", () => {
  it("decodes a well-formed household", () => {
    const h = decode(householdConverter, "h1", validHousehold);
    expect(h).toMatchObject({
      id: "h1",
      currency: "AUD",
      timezone: "Australia/Sydney",
      memberIds: ["u1", "u2"],
      cards: {},
    });
    expect(h?.defaultBudget).toEqual({
      amountCents: 90000,
      period: "fortnightly",
      anchorDate: "2026-09-01",
    });
  });

  it("refuses a household with no timezone", () => {
    // Every ledger date is computed in it. Missing, the app would bucket by
    // the device's clock and nothing on screen would look wrong.
    expectRejected(
      decode(householdConverter, "h1", { ...validHousehold, timezone: undefined }),
      "households/h1",
    );
  });

  it("refuses a default budget that is not one", () => {
    for (const defaultBudget of [
      undefined,
      { amountCents: 90000, period: "fortnightly" }, // no anchorDate
      { amountCents: 0, period: "weekly", anchorDate: "2026-09-01" },
      { amountCents: 90000, period: "monthly", anchorDate: "2026-09-01" },
    ]) {
      errors = [];
      expectRejected(
        decode(householdConverter, "h1", { ...validHousehold, defaultBudget }),
        "households/h1",
      );
    }
  });

  it("refuses memberIds that is not an array of strings", () => {
    expectRejected(
      decode(householdConverter, "h1", { ...validHousehold, memberIds: "u1" }),
      "households/h1",
    );
  });

  it("reads a rate that is not a number as no rate at all", () => {
    // A NaN rate would render every peso estimate as NaN; null renders as "no
    // estimate", which is the truth.
    const h = decode(householdConverter, "h1", {
      ...validHousehold,
      cardFees: { commissionArsCents: 4041322, usdArsRate: "1514" },
    });
    expect(h?.cardFees).toEqual({ commissionArsCents: 4041322, usdArsRate: null });
  });
});

describe("bankChargeConverter", () => {
  const valid = { usdCents: 1999, date: "2026-09-01", merchant: "STEAM" };

  it("decodes what the ingestion writes", () => {
    expect(decode(bankChargeConverter, "m1", valid)).toEqual({
      id: "m1",
      usdCents: 1999,
      date: "2026-09-01",
      merchant: "STEAM",
      cardLast4: null,
      dismissedAt: null,
    });
  });

  it("refuses a charge with no amount", () => {
    // This collection is written by an Apps Script from whatever the bank's
    // email looked like that morning, so it is the likeliest shape to drift —
    // and a charge missing its amount would still be matched to an expense and
    // mark it verified for nothing.
    expectRejected(decode(bankChargeConverter, "m1", { ...valid, usdCents: undefined }), "bankCharges/m1");
  });
});

describe("serviceConverter", () => {
  const valid = { name: "Netflix", amountAudCents: 2299, interval: "monthly", dueDay: 7 };

  it("decodes a well-formed service", () => {
    expect(decode(serviceConverter, "s1", valid)).toMatchObject({
      id: "s1",
      name: "Netflix",
      amountAudCents: 2299,
      amountUsdCents: null,
      interval: "monthly",
      dueDay: 7,
      paidWith: "debit",
    });
  });

  it("refuses a service with no name", () => {
    // The name is the entire link to the ledger: Servicios finds the expense
    // that paid a bill by matching it.
    expectRejected(decode(serviceConverter, "s1", { ...valid, name: "" }), "services/s1");
  });

  it("keeps a yearly service yearly", () => {
    // Regression: the first attempt at this validation spelled the interval
    // list by hand as "annual", and every yearly bill decoded as monthly —
    // which would have charged it twelve times a year on the Servicios total.
    expect(decode(serviceConverter, "s1", { ...valid, interval: "yearly" })?.interval).toBe("yearly");
  });

  it("clamps a nonsense due day instead of dropping the service", () => {
    // The day only decides when the bill falls due; a service whose name and
    // amount are right is worth keeping even if somebody typed 45.
    expect(decode(serviceConverter, "s1", { ...valid, dueDay: 45 })?.dueDay).toBe(1);
  });
});

describe("cardStatementConverter", () => {
  const valid = { startDate: "2026-08-15", dueDate: "2026-10-10" };

  it("takes the closing date from the document id", () => {
    expect(decode(cardStatementConverter, "2026-09-15", valid)).toEqual({
      startDate: "2026-08-15",
      closingDate: "2026-09-15",
      dueDate: "2026-10-10",
    });
  });

  it("refuses a statement whose id is not a date", () => {
    expectRejected(decode(cardStatementConverter, "current", valid), "cardStatements/current");
  });

  it("refuses a statement missing a boundary", () => {
    // `undefined <= "2026-09-04"` is false, which reads as "nothing is in this
    // statement" — a plausible answer and the wrong one.
    expectRejected(
      decode(cardStatementConverter, "2026-09-15", { ...valid, startDate: undefined }),
      "cardStatements/2026-09-15",
    );
  });
});

describe("cardChargeConverter", () => {
  const valid = { date: "2026-09-01", usdCents: 1718, detail: "DiDi", card: "visa" };

  it("decodes a charge, defaulting digital to true and verified to false", () => {
    // Opposite defaults on purpose: every charge written before these fields
    // existed was a digital service, and nobody had checked any of them.
    expect(decode(cardChargeConverter, "c1", valid)).toMatchObject({
      digital: true,
      verified: false,
      card: "visa",
    });
  });

  it("refuses a charge with no amount", () => {
    expectRejected(decode(cardChargeConverter, "c1", { ...valid, usdCents: null }), "cardCharges/c1");
  });

  it("falls back to visa for a brand it does not know", () => {
    expect(decode(cardChargeConverter, "c1", { ...valid, card: "amex" })?.card).toBe("visa");
  });
});

describe("userConverter", () => {
  it("decodes a profile", () => {
    expect(decode(userConverter, "u1", { displayName: "Cristian", householdId: "h1", language: "es" })).toEqual({
      uid: "u1",
      displayName: "Cristian",
      householdId: "h1",
      language: "es",
    });
  });

  it("reads no household as null, which is what onboarding means", () => {
    expect(decode(userConverter, "u1", { displayName: "Cristian" })?.householdId).toBeNull();
  });

  it("refuses a householdId of the wrong type", () => {
    // `42` is truthy, so it would take a signed-in person into
    // households/42 — a household that does not exist — instead of onboarding.
    expectRejected(decode(userConverter, "u1", { householdId: 42 }), "users/u1");
  });

  it("ignores a language it does not speak", () => {
    expect(decode(userConverter, "u1", { language: "pt" })?.language).toBeNull();
  });
});

describe("inviteConverter", () => {
  it("decodes an invite", () => {
    expect(decode(inviteConverter, "ABC123", { householdId: "h1", createdBy: "u1" })).toEqual({
      code: "ABC123",
      householdId: "h1",
      createdBy: "u1",
    });
  });

  it("refuses an invite that points nowhere", () => {
    // Otherwise it would send whoever redeems it into households/undefined.
    expectRejected(decode(inviteConverter, "ABC123", { createdBy: "u1" }), "invites/ABC123");
  });
});
