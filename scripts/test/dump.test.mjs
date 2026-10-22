import assert from "node:assert/strict";
import { test } from "node:test";
import { DUMP_FORMAT, createCodec, dumpFileName } from "../lib/dump.mjs";
import { KyberError } from "../lib/errors.mjs";
import { FakeTimestamp } from "./helpers.mjs";

const { serialize, revive, reviveLegacy, selectReviver, restorePlan } = createCodec({
  Timestamp: FakeTimestamp,
});
const INSTANT = "2026-09-09T12:34:56.789Z";
const ts = () => FakeTimestamp.fromDate(new Date(INSTANT));

// assert.throws matches a RegExp against the error's String() form, which
// carries the "KyberError: " prefix, so anchored checks go through the message.
const startsWith = (prefix) => (error) =>
  error instanceof KyberError && error.message.startsWith(prefix);

class GeoPointLike {
  constructor() {
    this.latitude = -34.6;
    this.longitude = -58.4;
  }
}

test("serialize tags Timestamps and leaves everything else JSON-shaped", () => {
  const out = serialize({
    name: "fixture household",
    cents: 1250,
    createdAt: ts(),
    tags: ["a", ts()],
    nested: { updatedAt: ts(), note: INSTANT },
    nothing: null,
  });
  assert.deepEqual(out, {
    name: "fixture household",
    cents: 1250,
    createdAt: { $timestamp: INSTANT },
    tags: ["a", { $timestamp: INSTANT }],
    nested: { updatedAt: { $timestamp: INSTANT }, note: INSTANT },
    nothing: null,
  });
});

test("serialize refuses the Firestore types no consumer uses, naming document and field", () => {
  assert.throws(
    () => serialize({ where: new GeoPointLike() }, "households/h1/expenses/e1"),
    (error) =>
      error instanceof KyberError &&
      error.message.startsWith("households/h1/expenses/e1.where: GeoPointLike is not supported"),
  );
  assert.throws(() => serialize({ blob: Buffer.from("x") }), startsWith("blob: Bytes is not supported"));
  assert.throws(() => serialize({ list: [1, new Uint8Array(2)] }, "d/1"), startsWith("d/1.list[1]: Bytes"));
});

test("serialize refuses NaN and Infinity, which JSON would write as null", () => {
  assert.equal(JSON.stringify({ n: Number.NaN }), '{"n":null}');
  assert.throws(() => serialize({ n: Number.NaN }, "d/1"), startsWith("d/1.n: NaN is not supported"));
  assert.throws(() => serialize({ list: [Number.NEGATIVE_INFINITY] }), startsWith("list[0]: -Infinity"));
  assert.deepEqual(serialize({ n: 0.1, big: Number.MAX_VALUE }), { n: 0.1, big: Number.MAX_VALUE });
});

test("serialize refuses a field name that collides with the tag namespace", () => {
  assert.throws(
    () => serialize({ nested: { $timestamp: "not a tag" } }),
    startsWith("nested.$timestamp: field names"),
  );
});

test("revive turns a lone $timestamp tag back into a Timestamp", () => {
  const out = revive({ createdAt: { $timestamp: INSTANT }, list: [{ $timestamp: INSTANT }] });
  assert.ok(out.createdAt instanceof FakeTimestamp);
  assert.equal(out.createdAt.toDate().toISOString(), INSTANT);
  assert.ok(out.list[0] instanceof FakeTimestamp);
});

test("revive rejects a $timestamp with siblings, or holding a non-string", () => {
  assert.throws(() => revive({ a: { $timestamp: INSTANT, extra: 1 } }), /only key/);
  assert.throws(() => revive({ a: { $timestamp: 42 } }), /hold a string/);
});

test("a $timestamp that is not a date is refused naming the value", () => {
  // The fake Timestamp takes an Invalid Date without complaint; the real one
  // throws a plain Error about "seconds" that names nothing.
  assert.throws(() => revive({ a: { $timestamp: "garbage" } }), startsWith('Corrupt dump: "garbage" is not a date'));
  assert.throws(() => reviveLegacy({ createdAt: "2026-13-01T00:00:00Z" }), /is not a date/);
});

test("revive rejects a tag it does not know", () => {
  assert.throws(() => revive({ a: { $geopoint: [1, 2] } }), /unknown tag "\$geopoint"/);
});

test("revive never applies the legacy heuristic", () => {
  const out = revive({ createdAt: INSTANT });
  assert.equal(out.createdAt, INSTANT);
});

test("serialize then revive is the identity on Firestore values", () => {
  const original = { createdAt: ts(), items: [{ n: 1, at: ts() }], name: "x" };
  const back = revive(JSON.parse(JSON.stringify(serialize(original))));
  assert.equal(back.createdAt.toDate().toISOString(), INSTANT);
  assert.equal(back.items[0].at.toDate().toISOString(), INSTANT);
  assert.equal(back.name, "x");
});

test("reviveLegacy converts an ISO instant under a key ending in At", () => {
  const out = reviveLegacy({ createdAt: INSTANT, history: { updatedAt: INSTANT } });
  assert.ok(out.createdAt instanceof FakeTimestamp);
  assert.ok(out.history.updatedAt instanceof FakeTimestamp);
  assert.equal(out.createdAt.toDate().toISOString(), INSTANT);
});

test("reviveLegacy leaves a calendar date alone even under a key ending in At", () => {
  const out = reviveLegacy({ cookedAt: "2026-08-29", lastCookedAt: "2026-08-29" });
  assert.equal(out.cookedAt, "2026-08-29");
  assert.equal(out.lastCookedAt, "2026-08-29");
});

test("reviveLegacy needs both signals: an instant under another key stays a string", () => {
  const out = reviveLegacy({ note: INSTANT, at: INSTANT, format: "2026-09-09T12:34:56Z" });
  assert.equal(out.note, INSTANT);
  assert.equal(out.at, INSTANT);
  assert.equal(out.format, "2026-09-09T12:34:56Z");
});

test("reviveLegacy rejects a dump that carries tags", () => {
  assert.throws(() => reviveLegacy({ createdAt: { $timestamp: INSTANT } }), /Corrupt dump/);
});

test("selectReviver: a formatted dump gets the tag reviver, heuristic off", () => {
  const dump = { format: DUMP_FORMAT, collections: {} };
  assert.equal(selectReviver(dump, {}), revive);
  assert.equal(selectReviver(dump, { restore: { legacyIsoTimestamps: true } }), revive);
});

test("selectReviver: no format and no opt-in is refused with instructions", () => {
  assert.throws(
    () => selectReviver({ collections: {} }, {}),
    (error) =>
      error instanceof KyberError && error.message.includes('"legacyIsoTimestamps": true'),
  );
  assert.throws(() => selectReviver({ collections: {} }, { restore: { legacyIsoTimestamps: "yes" } }), KyberError);
});

test("selectReviver: no format with the opt-in gets the legacy reviver", () => {
  const config = { restore: { legacyIsoTimestamps: true } };
  assert.equal(selectReviver({ collections: {} }, config), reviveLegacy);
});

test("selectReviver: a newer format is refused", () => {
  assert.throws(() => selectReviver({ format: DUMP_FORMAT + 1 }, {}), /Update kyber/);
});

test("selectReviver: format 1, which is format 2 without missing documents, still reads", () => {
  assert.equal(selectReviver({ format: 1, collections: {} }, {}), revive);
});

const dumpOf = (collections) => ({ format: DUMP_FORMAT, collections });

test("restorePlan lists every write, parents before children, values revived", () => {
  const writes = restorePlan(
    dumpOf({
      households: [
        {
          id: "h1",
          data: { name: "casa", createdAt: { $timestamp: INSTANT } },
          collections: { expenses: [{ id: "e1", data: { cents: 1250 } }] },
        },
      ],
      users: [{ id: "u1", data: {} }],
    }),
    {},
  );
  assert.deepEqual(
    writes.map(({ collection, id }) => `${collection}/${id}`),
    ["households/h1", "households/h1/expenses/e1", "users/u1"],
  );
  assert.ok(writes[0].data.createdAt instanceof FakeTimestamp);
  assert.deepEqual(writes[1].data, { cents: 1250 });
});

test("restorePlan refuses a bad value anywhere, before any write, naming the document", () => {
  // The case it exists for: the bad value is LAST, where a restore that
  // revived inside its write loop had already overwritten everything before it.
  const docs = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, data: { cents: i } }));
  docs[4].data.at = { $timestamp: "garbage" };
  assert.throws(
    () => restorePlan(dumpOf({ expenses: docs }), {}),
    startsWith('expenses/e4: Corrupt dump: "garbage" is not a date'),
  );
  assert.throws(
    () => restorePlan(dumpOf({ expenses: [{ id: "e1", data: { a: { $geo: 1 } } }] }), {}),
    startsWith('expenses/e1: Corrupt dump: unknown tag "$geo"'),
  );
});

test("restorePlan refuses documents it could not write where they came from", () => {
  for (const [doc, message] of [
    [{ data: {} }, "has no usable id"],
    [{ id: "", data: {} }, "has no usable id"],
    [{ id: "a/b", data: {} }, "has no usable id"],
    [{ id: "e1" }, "has no data object"],
    [{ id: "e1", data: [1] }, "has no data object"],
    [{ id: "e1", missing: true, data: {} }, "marked missing and also has data"],
    [{ id: "e1", data: {}, collections: [] }, "not an object"],
    ["e1", "is not a document"],
  ]) {
    assert.throws(() => restorePlan(dumpOf({ expenses: [doc] }), {}), (error) =>
      error instanceof KyberError && error.message.includes(message),
    );
  }
  assert.throws(() => restorePlan(dumpOf({ expenses: {} }), {}), /is not a list of documents/);
});

test("restorePlan keeps a missing parent without data, and what was under it", () => {
  const writes = restorePlan(
    dumpOf({
      households: [
        { id: "gone", missing: true, collections: { expenses: [{ id: "e1", data: { cents: 1 } }] } },
      ],
    }),
    {},
  );
  assert.deepEqual(writes, [
    { collection: "households", id: "gone", data: null },
    { collection: "households/gone/expenses", id: "e1", data: { cents: 1 } },
  ]);
});

test("restorePlan uses the legacy reviver only where selectReviver would", () => {
  const legacy = { collections: { d: [{ id: "1", data: { createdAt: INSTANT } }] } };
  assert.throws(() => restorePlan(legacy, {}), /legacyIsoTimestamps/);
  const [write] = restorePlan(legacy, { restore: { legacyIsoTimestamps: true } });
  assert.ok(write.data.createdAt instanceof FakeTimestamp);
});

test("dumpFileName is <name>-<source>-<stamp>.json with a filesystem-safe stamp", () => {
  const name = dumpFileName("fixture", "production", new Date("2026-09-14T10:20:30.400Z"));
  assert.equal(name, "fixture-production-2026-09-14T10-20-30-400Z.json");
});
