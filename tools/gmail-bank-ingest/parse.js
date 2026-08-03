/**
 * Parsing the bank's "Novedades de tus transacciones" notification.
 *
 * This file is plain ES5-ish JavaScript on purpose: the SAME source is pasted
 * into the Apps Script project (which concatenates its files, so these become
 * globals for Code.gs) and imported by the vitest suite in this folder. The
 * CommonJS export at the bottom is guarded, because `module` does not exist in
 * Apps Script.
 *
 * The email is HTML. Its one meaningful sentence reads:
 *
 *   Queremos informarte que registramos una autorización de consumo de
 *   U$S 63,90 en el establecimiento COLES 0831 , el día 01/08/2026 a las
 *   02:13hs con la tarjeta de CRISTIAN CARDOZO finalizada en 2024
 *
 * Everything the matcher needs is in there: the USD the bank charged, the
 * merchant, the moment, and the last four digits of the card. There is NO AUD
 * figure — that is why matching leans on the learned rate (see
 * apps/web/src/lib/bank-match.ts).
 *
 * The timestamp is Argentine wall time (the notifier sits in ART, -03, which
 * has no DST), while the expense was typed on a household-timezone date. So the
 * date is converted, not copied: an 8pm ART purchase is already the next day in
 * Sydney, and a charge filed under the wrong day would sit outside the matcher's
 * window.
 */

/** Collapse an HTML body down to its text, entities and all. */
function bankEmailText(html) {
  var text = String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  // The handful of entities this mailer actually emits.
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, function (_, code) {
      return String.fromCharCode(Number(code));
    });
  return text.replace(/[\s ]+/g, " ").trim();
}

/** "63,90" → 6390. Dots are thousands, the comma is the decimal separator. */
function moneyToCents(raw) {
  var normalized = String(raw).replace(/\./g, "").replace(",", ".");
  var value = Number(normalized);
  if (!isFinite(value) || value <= 0) return null;
  var cents = Math.round(value * 100);
  return cents > 0 ? cents : null;
}

/**
 * The household-timezone calendar date of an ART wall time.
 *
 * ART is a fixed -03 with no DST, so the instant is unambiguous: add 3 hours to
 * get UTC, then ask Intl for that instant's date in the household zone.
 */
function householdDate(year, month, day, hour, minute, timeZone) {
  var instant = new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
  var parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  // en-CA already formats as YYYY-MM-DD.
  return parts;
}

/**
 * Parse one notification body into a charge, or null when the email is not an
 * authorised-purchase notice (reversals, informational mails, format changes).
 * Returning null is normal and must never be treated as an error.
 */
function parseBankNotification(html, timeZone) {
  var text = bankEmailText(html);

  // Only authorised purchases become charges. A reversal ("reverso",
  // "devolución") is about money coming back and has no expense to verify.
  if (!/autorizaci[oó]n de consumo/i.test(text)) return null;
  if (/revers|devoluci[oó]n|rechaz/i.test(text)) return null;

  var amount = text.match(/U\$S\s*([\d.,]+)/i) || text.match(/US\$\s*([\d.,]+)/i);
  if (amount === null) return null;
  var usdCents = moneyToCents(amount[1]);
  if (usdCents === null) return null;

  var when = text.match(
    /el d[ií]a\s+(\d{2})\/(\d{2})\/(\d{4})\s+a las\s+(\d{1,2}):(\d{2})/i,
  );
  if (when === null) return null;
  var date = householdDate(
    Number(when[3]),
    Number(when[2]),
    Number(when[1]),
    Number(when[4]),
    Number(when[5]),
    timeZone,
  );

  var merchantMatch = text.match(
    /en el establecimiento\s+(.+?)\s*,?\s*el d[ií]a/i,
  );
  var merchant = merchantMatch === null ? "" : merchantMatch[1].trim();

  var cardMatch = text.match(/finalizada en\s+(\d{4})/i);

  return {
    usdCents: usdCents,
    date: date,
    merchant: merchant.slice(0, 120),
    cardLast4: cardMatch === null ? null : cardMatch[1],
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    bankEmailText: bankEmailText,
    moneyToCents: moneyToCents,
    householdDate: householdDate,
    parseBankNotification: parseBankNotification,
  };
}
