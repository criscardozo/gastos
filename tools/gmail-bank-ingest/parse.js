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
 *   02:13hs con la tarjeta de NOMBRE APELLIDO finalizada en 1234
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
  // ONE pass over every entity, so what one decodes to is never decoded
  // again: "&amp;quot;" is the text "&quot;", not a quote. The chain of
  // replaces this used to be decoded &amp; before the numeric ones, and knew
  // no &quot;, &#39; or hex form — a merchant with quotes in its name arrived
  // with "&quot;" in it, and so did any rule pattern written from it.
  // Unknown names are left exactly as written.
  text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (whole, name) {
    if (name.charAt(0) === "#") {
      var code =
        name.charAt(1).toLowerCase() === "x"
          ? parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      return isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    var named = NAMED_ENTITIES[name.toLowerCase()];
    if (named === undefined) return whole;
    // Case carries meaning for the letters: &Iacute; is Í, &iacute; is í.
    return /^[A-Z]/.test(name) ? named.toUpperCase() : named;
  });
  return text.replace(/[\s ]+/g, " ").trim();
}

/** The entities a Spanish-language mailer can plausibly emit. */
var NAMED_ENTITIES = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  uuml: "ü",
  ntilde: "ñ",
  iquest: "¿",
  iexcl: "¡",
  ordm: "º",
  ordf: "ª",
};

/**
 * "63,90" → 6390. Dots are thousands, the comma is the decimal separator.
 *
 * Only that shape. It used to strip every dot and read the rest, so "63.90"
 * became 6390 DOLLARS. An amount written any other way is null, which the
 * caller reports as a purchase it could not read rather than guessing.
 */
function moneyToCents(raw) {
  var s = String(raw);
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(s)) return null;
  var normalized = s.replace(/\./g, "").replace(",", ".");
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
 * What one notification email is:
 * - `{ status: "charge", charge }` — an authorised purchase, read;
 * - `{ status: "ignored" }` — not a purchase (a reversal, a statement notice);
 * - `{ status: "unparsed" }` — a purchase notice this could not read.
 *
 * The third used to come back as null like the second, so the run remembered
 * it as seen and never looked again, with the heartbeat green: a change in the
 * bank's wording would have stopped every charge in silence. Now the run keeps
 * it unseen and fails loudly instead.
 */
function classifyBankNotification(html, timeZone) {
  var text = bankEmailText(html);

  if (!/autorizaci[oó]n de consumo/i.test(text)) return { status: "ignored" };
  // A reversal ("reverso", "devolución", "rechazo") is about money coming
  // back and has no expense to verify. Looked for only BEFORE the merchant:
  // read over the whole mail it matched shop names, and "REVERSE CAFE" was
  // dropped for good.
  var head = text.split(/en el establecimiento/i)[0];
  if (/revers|devoluci[oó]n|rechaz/i.test(head)) return { status: "ignored" };

  var amount = text.match(/U\$S\s*([\d.,]+)/i) || text.match(/US\$\s*([\d.,]+)/i);
  if (amount === null) return { status: "unparsed" };
  var usdCents = moneyToCents(amount[1]);
  if (usdCents === null) return { status: "unparsed" };

  var when = text.match(
    /el d[ií]a\s+(\d{2})\/(\d{2})\/(\d{4})\s+a las\s+(\d{1,2}):(\d{2})/i,
  );
  if (when === null) return { status: "unparsed" };
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
    status: "charge",
    charge: {
      usdCents: usdCents,
      date: date,
      merchant: merchant.slice(0, 120),
      cardLast4: cardMatch === null ? null : cardMatch[1],
    },
  };
}

/** The charge in one notification, or null for anything else. */
function parseBankNotification(html, timeZone) {
  var result = classifyBankNotification(html, timeZone);
  return result.status === "charge" ? result.charge : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    bankEmailText: bankEmailText,
    moneyToCents: moneyToCents,
    householdDate: householdDate,
    parseBankNotification: parseBankNotification,
    classifyBankNotification: classifyBankNotification,
  };
}
