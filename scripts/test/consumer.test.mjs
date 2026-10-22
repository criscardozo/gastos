import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { test } from "node:test";
import { consumerRoot, loadConsumer } from "../lib/consumer.mjs";
import { KyberError } from "../lib/errors.mjs";
import { CONSUMER } from "./helpers.mjs";

/** Does any ancestor of `dir` (inclusive) hold a consumer config? */
function hasConfigAbove(dir) {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, "scripts", "project.json"))) return true;
    if (dirname(at) === at) return false;
  }
}

test("consumerRoot walks up from a nested directory to the config", () => {
  assert.equal(consumerRoot(join(CONSUMER, "deep", "er")), CONSUMER);
  assert.equal(consumerRoot(CONSUMER), CONSUMER);
});

test("consumerRoot fails out loud when no ancestor has a config", () => {
  // The isolation is BUILT, not assumed: a fresh temp directory, checked to
  // have no config above it, so the assertion means the same thing wherever
  // this suite is run from.
  const nowhere = mkdtempSync(join(tmpdir(), "kyber-nowhere-"));
  assert.equal(hasConfigAbove(nowhere), false, `${nowhere} unexpectedly sits inside a consumer`);
  assert.throws(
    () => consumerRoot(nowhere),
    (error) =>
      error instanceof KyberError &&
      error.message.includes("scripts/project.json") &&
      error.message.includes(nowhere),
  );
});

test("consumerRoot's default start is kyber's own directory", () => {
  // kyber spends most of its life as a submodule, so the default start has
  // two legitimate outcomes and this pins the invariant both share: either
  // there is no consumer above and it refuses, or it names a directory that
  // really is one.
  //
  // The first version of this test asserted only the refusal, and its comment
  // said that a config appearing in a parent would mean that parent was the
  // bug. Backwards: checked out inside a consumer — the normal case — the test
  // failed and the parent was the whole point. A guard that predicts the wrong
  // culprit sends you hunting for a stray .kyber that is actually the design
  // working.
  let root;
  try {
    root = consumerRoot();
  } catch (error) {
    assert.ok(error instanceof KyberError, "expected a KyberError, got: " + error);
    return; // A standalone kyber clone: nothing above it, and it said so.
  }
  // A kyber inside a consumer. Normal; the answer still has to be true.
  assert.ok(
    existsSync(join(root, "scripts", "project.json")),
    `consumerRoot() returned ${root}, which has no scripts/project.json`,
  );
  assert.ok(
    import.meta.dirname.startsWith(root + sep),
    `consumerRoot() returned ${root}, which is not an ancestor of this test`,
  );
});

test("loadConsumer returns the config and resolves directories against the root", () => {
  const { root, config, dir } = loadConsumer({
    required: ["name", "projectId", "firebaseDir"],
    from: CONSUMER,
  });
  assert.equal(root, CONSUMER);
  assert.equal(config.projectId, "fixture-project");
  assert.equal(dir("firebaseDir"), join(CONSUMER, "firebase"));
});

test("loadConsumer tolerates keys it was not asked about", () => {
  const { config } = loadConsumer({ required: ["name"], from: CONSUMER });
  assert.deepEqual(config.somethingForALaterBatch, { kept: true });
});

test("loadConsumer names every missing or empty required key", () => {
  const root = mkdtempSync(join(tmpdir(), "kyber-consumer-"));
  mkdirSync(join(root, "scripts"));
  writeFileSync(
    join(root, "scripts", "project.json"),
    JSON.stringify({ name: "x", projectId: "   ", firebaseDir: 3 }),
  );
  assert.throws(
    () => loadConsumer({ required: ["name", "projectId", "firebaseDir", "rulesTestsDir"], from: root }),
    (error) =>
      error instanceof KyberError &&
      error.message.includes('"projectId"') &&
      error.message.includes('"firebaseDir"') &&
      error.message.includes('"rulesTestsDir"') &&
      !error.message.includes('"name"'),
  );
});

test("loadConsumer rejects a config that is not a JSON object", () => {
  const root = mkdtempSync(join(tmpdir(), "kyber-consumer-"));
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "project.json"), "[]");
  assert.throws(() => loadConsumer({ from: root }), /must hold a JSON object/);
  writeFileSync(join(root, "scripts", "project.json"), "{ not json");
  assert.throws(() => loadConsumer({ from: root }), /not valid JSON/);
});
