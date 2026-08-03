import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  bankEmailText,
  householdDate,
  moneyToCents,
  parseBankNotification,
} from "./parse.js";

/** The real notification, with the cardholder name and card digits scrubbed. */
const SAMPLE = readFileSync(
  fileURLToPath(new URL("./fixtures/consumo-autorizado.html", import.meta.url)),
  "utf-8",
);

const SYDNEY = "Australia/Sydney";

describe("parseBankNotification", () => {
  it("reads the charge out of the bank's real email", () => {
    const charge = parseBankNotification(SAMPLE, SYDNEY);
    expect(charge).toEqual({
      usdCents: 6390,
      // 01/08/2026 02:13 ART = 05:13 UTC = 15:13 in Sydney: same day.
      date: "2026-08-01",
      merchant: "COLES 0831",
      cardLast4: "1234",
    });
  });

  it("survives the amount being split across tags", () => {
    // The mailer wraps "U$S" and "63,90" in separate <span>s.
    expect(bankEmailText("<b><span>U$S</span> <span>63,90</span></b>")).toBe(
      "U$S 63,90",
    );
  });

  it("files the charge under the household's day, not Argentina's", () => {
    // 31/07 21:30 ART is already 10:30 on 1 August in Sydney.
    const charge = parseBankNotification(
      body({ date: "31/07/2026", time: "21:30" }),
      SYDNEY,
    );
    expect(charge?.date).toBe("2026-08-01");
  });

  it("keeps the same day when the conversion does not cross midnight", () => {
    const charge = parseBankNotification(
      body({ date: "31/07/2026", time: "02:13" }),
      SYDNEY,
    );
    expect(charge?.date).toBe("2026-07-31");
  });

  it("ignores a reversal — there is no expense to verify", () => {
    const reversal = body({}).replace(
      "autorización de consumo",
      "reverso de autorización de consumo",
    );
    expect(parseBankNotification(reversal, SYDNEY)).toBeNull();
  });

  it("ignores an email that is not a purchase notice at all", () => {
    expect(
      parseBankNotification("<p>Tu resumen ya está disponible</p>", SYDNEY),
    ).toBeNull();
  });

  it("returns null rather than half a charge when the date is missing", () => {
    expect(parseBankNotification(body({ withDate: false }), SYDNEY)).toBeNull();
  });

  it("copes with a thousands separator and no card line", () => {
    const charge = parseBankNotification(
      body({ amount: "1.234,56", withCard: false }),
      SYDNEY,
    );
    expect(charge?.usdCents).toBe(123456);
    expect(charge?.cardLast4).toBeNull();
  });

  it("takes the merchant without the trailing padding the mailer adds", () => {
    const charge = parseBankNotification(
      body({ merchant: "WOOLWORTHS 2914      " }),
      SYDNEY,
    );
    expect(charge?.merchant).toBe("WOOLWORTHS 2914");
  });
});

describe("moneyToCents", () => {
  it("treats the comma as the decimal separator", () => {
    expect(moneyToCents("63,90")).toBe(6390);
    expect(moneyToCents("1.234,56")).toBe(123456);
    expect(moneyToCents("8")).toBe(800);
  });

  it("rejects anything that is not a positive amount", () => {
    expect(moneyToCents("0,00")).toBeNull();
    expect(moneyToCents("")).toBeNull();
    expect(moneyToCents("abc")).toBeNull();
  });
});

describe("householdDate", () => {
  it("converts ART wall time to the household calendar date", () => {
    expect(householdDate(2026, 8, 1, 2, 13, SYDNEY)).toBe("2026-08-01");
    expect(householdDate(2026, 7, 31, 21, 30, SYDNEY)).toBe("2026-08-01");
    // Sydney is +11 in January (DST) — the offset is not hardcoded anywhere.
    expect(householdDate(2026, 1, 15, 22, 0, SYDNEY)).toBe("2026-01-16");
  });
});

/** A minimal notification body, shaped like the real one. */
function body({
  amount = "63,90",
  merchant = "COLES 0831",
  date = "01/08/2026",
  time = "02:13",
  withDate = true,
  withCard = true,
} = {}) {
  const when = withDate
    ? `, el día <b><span>${date}</b> a las <b><span>${time}hs</span></b>`
    : ", hoy";
  const card = withCard ? " finalizada en <b><span>1234</span></b>" : "";
  return `<p>Queremos informarte que registramos una autorización de consumo de <b><span>U$S</span> <span>${amount}</span></b> en el establecimiento <b><span>${merchant}</span></b>${when} con la tarjeta de <b><span>NOMBRE APELLIDO</span></b>${card}</p>`;
}
