// Guards for documents arriving from Firestore.
//
// The security rules already refuse a badly shaped WRITE, so in theory nothing
// malformed can be in the database. In practice three things write there that
// the rules do not police the same way: the Apps Script that files bank
// charges, the emulator seed (admin writes bypass rules entirely), and older
// builds of both clients whose idea of a document was a field or two different.
//
// What these are for is the failure that does not look like one. A converter
// that casts `data.amountCents as number` turns a missing field into
// `undefined`, and `undefined` formats as "$NaN", sums as NaN, and quietly
// poisons a total. Reading it back as "this document does not decode" is worth
// more than reading it back as a number that is wrong.
//
// Hand-written rather than a schema library on purpose: this app ships firebase
// (776 KB), exceljs and jspdf, and keeps the last two out of the first load
// deliberately. Ten predicates are not worth another dependency in the bundle.

/** A non-empty string. Empty is almost always a missing field, not a value. */
export function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A string that may legitimately be empty (a note, a merchant name). */
export function isMaybeEmptyString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Integer cents.
 *
 * The whole ledger is integers by rule — never floats, never decimal strings —
 * so a float here is a bug upstream, not a value to round.
 */
export function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Integer cents that must be positive: a budget, an amount charged. */
export function isPositiveInt(value: unknown): value is number {
  return isInt(value) && value > 0;
}

/** Zero-padded "YYYY-MM-DD", the only date format the ledger stores. */
export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** One of a fixed set — a period type, a source, a card brand. */
export function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Say which document failed and why, and return null so the caller drops it.
 *
 * Console rather than the error dialog, deliberately. A dialog is for something
 * the person can act on now; one historical document that stopped decoding
 * would raise it on every snapshot forever, and burying the app under a modal
 * is a worse failure than the one being reported. `[gastos]` is the prefix
 * every listener in this codebase already logs under, so one filter finds
 * all of it.
 */
export function rejectDoc(path: string, why: string): null {
  console.error(`[gastos] ${path} does not decode: ${why}`);
  return null;
}

/**
 * Drop the documents that did not decode.
 *
 * Every listener maps a snapshot through its converter and then through this.
 * The name is the point: `decoded(...)` at a call site says a document may
 * legitimately be missing from the result, which `.filter(Boolean)` does not.
 */
export function decoded<T>(docs: (T | null)[]): T[] {
  return docs.filter((doc): doc is T => doc !== null);
}
