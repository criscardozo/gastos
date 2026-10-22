// The dump format: Firestore values to JSON and back.
//
// Pure functions. The Firestore `Timestamp` class is injected rather than
// imported so that this file — and its tests — run in a bare kyber clone with
// nothing installed; the scripts pass the real one from firebase-admin.
//
// Timestamps are TAGGED (`{"$timestamp": "<ISO>"}`) rather than flattened to a
// string, because the flattened form cannot be checked: a restore writes plain
// strings back, the next dump serialises those to the same characters, and
// comparing dump against dump agrees perfectly while every audit field has
// quietly changed type. A round trip would prove nothing, which is the one
// thing it exists to prove.
//
// Anything else Firestore can hold and no consumer uses — GeoPoint,
// DocumentReference, Bytes — throws instead of being mangled into a shape that
// looks fine in JSON. If one ever appears, the backup stops rather than lying.
// The same goes for NaN and ±Infinity, which Firestore stores as doubles and
// JSON.stringify writes as `null` without a word.

import { KyberError } from "./errors.mjs";

/**
 * Written into every dump's header. Bump it when the shape changes.
 *
 * 2 added `"missing": true`: a document that does not exist but has
 * subcollections under it, which format 1 left out of the dump entirely. The
 * bump is what keeps an older restore from reading one as an empty document
 * and creating it; that restore refuses a format it does not know.
 */
export const DUMP_FORMAT = 2;

/** Formats this restore reads. 1 is 2 without `missing`, so one reader serves both. */
const READABLE_FORMATS = new Set([1, 2]);

/** A strict ISO-8601 instant, the only string the legacy path ever converts. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (value.constructor === undefined || value.constructor === Object);

export function createCodec({ Timestamp }) {
  /**
   * Firestore values to JSON. `at` names the document, and the path grows as
   * the recursion descends, so a refusal says WHICH field of WHICH document
   * to go and look at, not only which type.
   */
  function serialize(value, at = "") {
    const refuse = (what) =>
      new KyberError(
        `${at === "" ? "value" : at}: ${what} is not supported by the dump format. ` +
          "Teach serialize() about it first, or change the field.",
      );
    if (value instanceof Timestamp) {
      return { $timestamp: value.toDate().toISOString() };
    }
    if (Array.isArray(value)) return value.map((item, i) => serialize(item, `${at}[${i}]`));
    if (value instanceof Uint8Array) throw refuse("Bytes");
    if (typeof value === "number" && !Number.isFinite(value)) throw refuse(String(value));
    if (value !== null && typeof value === "object") {
      if (!isPlainObject(value)) throw refuse(value.constructor?.name ?? "a non-plain object");
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          const here = at === "" ? key : `${at}.${key}`;
          if (key.startsWith("$")) {
            throw new KyberError(
              `${here}: field names starting with "$" are reserved for the dump format's tags.`,
            );
          }
          return [key, serialize(child, here)];
        }),
      );
    }
    return value;
  }

  /**
   * An ISO string to a Timestamp, refusing one that is not a date. Without the
   * check a hand-edited value reaches firebase-admin, which throws a plain
   * Error about "seconds" that names neither the value nor the document.
   */
  function timestampOf(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new KyberError(`Corrupt dump: ${JSON.stringify(iso)} is not a date.`);
    }
    return Timestamp.fromDate(date);
  }

  /** Tagged shapes back into Firestore values. For dumps with a `format`. */
  function revive(value) {
    if (Array.isArray(value)) return value.map(revive);
    if (value !== null && typeof value === "object") {
      const keys = Object.keys(value);
      if ("$timestamp" in value) {
        if (keys.length !== 1 || typeof value.$timestamp !== "string") {
          throw new KyberError(
            `Corrupt dump: a "$timestamp" tag must be the only key of its object ` +
              `and hold a string, got ${JSON.stringify(value)}.`,
          );
        }
        return timestampOf(value.$timestamp);
      }
      const unknownTag = keys.find((key) => key.startsWith("$"));
      if (unknownTag !== undefined) {
        throw new KyberError(`Corrupt dump: unknown tag "${unknownTag}".`);
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
    }
    return value;
  }

  /**
   * The pre-`format` shape, where Timestamps were flattened to ISO strings.
   *
   * Guessing a Timestamp back from the string alone would be wrong the first
   * time somebody writes a note that looks like a date, so this needs BOTH
   * signals: the key ends in `At` and the value is a strict ISO-8601 instant.
   * A `"YYYY-MM-DD"` under a key ending in `At` is a calendar date and stays a
   * string. Only ever enabled by the consumer, per `selectReviver`.
   */
  function reviveLegacy(value, key = "") {
    if (typeof value === "string" && key.endsWith("At") && ISO_INSTANT.test(value)) {
      return timestampOf(value);
    }
    if (Array.isArray(value)) return value.map((v) => reviveLegacy(v, key));
    if (value !== null && typeof value === "object") {
      if ("$timestamp" in value) {
        throw new KyberError(
          'Corrupt dump: it has no "format" but contains "$timestamp" tags. ' +
            "A legacy dump never has tags; a tagged dump always has a format.",
        );
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, reviveLegacy(v, k)]),
      );
    }
    return value;
  }

  /**
   * Which reviver a dump needs, decided by its header AND the consumer.
   *
   * `format` present: tags only, the heuristic stays off.
   * `format` absent: the legacy heuristic, but only for a consumer that has
   * declared `restore.legacyIsoTimestamps: true` — the one with real dumps
   * from before the format existed. For anyone else that path does not exist,
   * so it cannot convert something by accident.
   */
  function selectReviver(dump, config) {
    if (dump.format === undefined) {
      if (config?.restore?.legacyIsoTimestamps === true) return reviveLegacy;
      throw new KyberError(
        'This dump has no "format" field, so it predates the tagged format.\n' +
          "  Reading it needs the legacy heuristic (ISO strings under keys ending\n" +
          '  in "At" become Timestamps), which this consumer has not enabled. If\n' +
          "  it genuinely has dumps from before the format, set\n" +
          '  "restore": { "legacyIsoTimestamps": true } in scripts/project.json.',
      );
    }
    if (READABLE_FORMATS.has(dump.format)) return revive;
    throw new KyberError(
      `This dump is format ${JSON.stringify(dump.format)}; this restore reads ` +
        `format ${DUMP_FORMAT}. Update kyber before restoring it.`,
    );
  }

  /**
   * Every write a restore will make, in order, with every value already
   * revived — or a refusal, before anything has been written.
   *
   * Reviving inside the write loop meant a bad value in document 300 of 500
   * stopped a production restore with 299 documents already overwritten, and
   * the promise that an unreadable dump is refused with nothing written was
   * only true of the header. Now the whole tree is read first; the loop that
   * writes has nothing left in it that can refuse.
   *
   * A `missing` document is kept in the plan without data: its subcollections
   * are restored under it and the document itself is not created, which is
   * how it was found.
   */
  function restorePlan(dump, config) {
    const revive = selectReviver(dump, config);
    const writes = [];
    const walk = (collectionPath, docs) => {
      if (!Array.isArray(docs)) {
        throw new KyberError(`Corrupt dump: ${collectionPath} is not a list of documents.`);
      }
      docs.forEach((doc, i) => {
        const at = `${collectionPath}[${i}]`;
        if (doc === null || typeof doc !== "object") {
          throw new KyberError(`Corrupt dump: ${at} is not a document.`);
        }
        if (typeof doc.id !== "string" || doc.id === "" || doc.id.includes("/")) {
          throw new KyberError(`Corrupt dump: ${at} has no usable id (${JSON.stringify(doc.id)}).`);
        }
        const path = `${collectionPath}/${doc.id}`;
        let data = null;
        if (doc.missing === true) {
          if ("data" in doc) {
            throw new KyberError(`Corrupt dump: ${path} is marked missing and also has data.`);
          }
        } else {
          if (!isPlainObject(doc.data)) {
            throw new KyberError(`Corrupt dump: ${path} has no data object.`);
          }
          try {
            data = revive(doc.data);
          } catch (error) {
            if (error instanceof KyberError) throw new KyberError(`${path}: ${error.message}`);
            throw error;
          }
        }
        writes.push({ collection: collectionPath, id: doc.id, data });
        const children = doc.collections ?? {};
        if (!isPlainObject(children)) {
          throw new KyberError(`Corrupt dump: ${path} has a "collections" that is not an object.`);
        }
        for (const [name, childDocs] of Object.entries(children)) walk(`${path}/${name}`, childDocs);
      });
    };
    for (const [name, docs] of Object.entries(dump.collections)) walk(name, docs);
    return writes;
  }

  return { serialize, revive, reviveLegacy, selectReviver, restorePlan };
}

/** `<name>-<source>-<stamp>.json`, a name a directory listing can be read by. */
export function dumpFileName(name, source, when = new Date()) {
  const stamp = when.toISOString().replace(/[:.]/g, "-");
  return `${name}-${source}-${stamp}.json`;
}
