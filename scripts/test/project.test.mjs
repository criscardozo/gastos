import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { test } from "node:test";
import { projectRoot, loadProject } from "../lib/project.mjs";
import { ScriptError } from "../lib/errors.mjs";
import { PROJECT } from "./helpers.mjs";

/** Does any ancestor of `dir` (inclusive) hold a project config? */
function hasConfigAbove(dir) {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, "scripts", "project.json"))) return true;
    if (dirname(at) === at) return false;
  }
}

test("projectRoot walks up from a nested directory to the config", () => {
  assert.equal(projectRoot(join(PROJECT, "deep", "er")), PROJECT);
  assert.equal(projectRoot(PROJECT), PROJECT);
});

test("projectRoot fails out loud when no ancestor has a config", () => {
  // The isolation is BUILT, not assumed: a fresh temp directory, checked to
  // have no config above it, so the assertion means the same thing wherever
  // this suite is run from.
  const nowhere = mkdtempSync(join(tmpdir(), "gastos-nowhere-"));
  assert.equal(hasConfigAbove(nowhere), false, `${nowhere} unexpectedly sits inside a project`);
  assert.throws(
    () => projectRoot(nowhere),
    (error) =>
      error instanceof ScriptError &&
      error.message.includes("scripts/project.json") &&
      error.message.includes(nowhere),
  );
});

test("projectRoot's default start finds this repo", () => {
  // The default start is the scripts' own directory, inside the repo, so it
  // must name a directory that really holds the config and contains this test.
  const root = projectRoot();
  assert.ok(
    existsSync(join(root, "scripts", "project.json")),
    `projectRoot() returned ${root}, which has no scripts/project.json`,
  );
  assert.ok(
    import.meta.dirname.startsWith(root + sep),
    `projectRoot() returned ${root}, which is not an ancestor of this test`,
  );
});

test("loadProject returns the config and resolves directories against the root", () => {
  const { root, config, dir } = loadProject({
    required: ["name", "projectId", "firebaseDir"],
    from: PROJECT,
  });
  assert.equal(root, PROJECT);
  assert.equal(config.projectId, "fixture-project");
  assert.equal(dir("firebaseDir"), join(PROJECT, "firebase"));
});

test("loadProject tolerates keys it was not asked about", () => {
  const { config } = loadProject({ required: ["name"], from: PROJECT });
  assert.deepEqual(config.somethingForALaterBatch, { kept: true });
});

test("loadProject names every missing or empty required key", () => {
  const root = mkdtempSync(join(tmpdir(), "gastos-project-"));
  mkdirSync(join(root, "scripts"));
  writeFileSync(
    join(root, "scripts", "project.json"),
    JSON.stringify({ name: "x", projectId: "   ", firebaseDir: 3 }),
  );
  assert.throws(
    () => loadProject({ required: ["name", "projectId", "firebaseDir", "rulesTestsDir"], from: root }),
    (error) =>
      error instanceof ScriptError &&
      error.message.includes('"projectId"') &&
      error.message.includes('"firebaseDir"') &&
      error.message.includes('"rulesTestsDir"') &&
      !error.message.includes('"name"'),
  );
});

test("loadProject rejects a config that is not a JSON object", () => {
  const root = mkdtempSync(join(tmpdir(), "gastos-project-"));
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "project.json"), "[]");
  assert.throws(() => loadProject({ from: root }), /must hold a JSON object/);
  writeFileSync(join(root, "scripts", "project.json"), "{ not json");
  assert.throws(() => loadProject({ from: root }), /not valid JSON/);
});
