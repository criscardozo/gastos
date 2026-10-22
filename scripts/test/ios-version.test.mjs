import assert from "node:assert/strict";
import { test } from "node:test";
import { ScriptError } from "../lib/errors.mjs";
import { readTargets, versionProblems, writeVersion } from "../lib/ios-version.mjs";

const YAML = `name: Fixture
options:
  deploymentTarget:
    iOS: "26.0"
targets:
  App:
    type: application
    settings:
      base:
        MARKETING_VERSION: "1.1.0"
        CURRENT_PROJECT_VERSION: "1"
    info:
      properties:
        CFBundleShortVersionString: $(MARKETING_VERSION)
  AppWidget:
    type: app-extension
    settings:
      base:
        MARKETING_VERSION: "1.1.0"
    info:
      properties:
        CFBundleShortVersionString: $(MARKETING_VERSION)
  AppWatch:
    type: application
    settings:
      base:
        MARKETING_VERSION: "1.1.0"
    info:
      properties:
        CFBundleShortVersionString: $(MARKETING_VERSION)
  AppTests:
    type: bundle.unit-test
schemes:
  App:
    build: {}
`;
const NAMES = ["App", "AppWidget", "AppWatch"];

test("readTargets finds every target and the settings each one carries", () => {
  const targets = readTargets(YAML);
  assert.deepEqual([...targets.keys()], ["App", "AppWidget", "AppWatch", "AppTests"]);
  assert.equal(targets.get("App").marketingVersion, "1.1.0");
  assert.equal(targets.get("App").shortVersion, "$(MARKETING_VERSION)");
  // The test bundle carries no version, and that is not a problem.
  assert.equal(targets.get("AppTests").marketingVersion, undefined);
});

test("readTargets stops at the next top-level key", () => {
  // `schemes:` also has two-space children; reading past `targets:` would
  // collect them as targets and the count would look right for the wrong file.
  assert.equal(readTargets(YAML).has("schemes"), false);
});

test("readTargets refuses a file without a targets block", () => {
  assert.throws(() => readTargets("name: Fixture\noptions: {}\n"), ScriptError);
});

test("a project in the expected shape has no problems", () => {
  assert.deepEqual(versionProblems(readTargets(YAML), NAMES), []);
});

test("a named target that is not in the file is named back", () => {
  const problems = versionProblems(readTargets(YAML), [...NAMES, "AppClip"]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"AppClip" is in iosTargets but not in project\.yml/);
});

test("a substitution is caught, which is what a count cannot do", () => {
  // Swap one target for another: still three carrying MARKETING_VERSION, so
  // `found.length === 3` passes while the version now moves somewhere nobody
  // named and stops moving where somebody expected it.
  //
  // The exact 3 below is deliberate and must stay exact: the population is
  // this file's own fixture, and the whole point is that the count does NOT
  // move under a substitution. A floor here would delete the test's meaning.
  // Said out loud because a consistency pass that turns counts into floors
  // would otherwise read it as the one somebody forgot.
  const swapped = YAML.replace("  AppWatch:", "  AppClip:");
  const targets = readTargets(swapped);
  assert.equal([...targets.values()].filter((t) => t.marketingVersion !== undefined).length, 3);
  const problems = versionProblems(targets, NAMES);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /"AppWatch" is in iosTargets but not in project\.yml/);
  assert.match(problems.join("\n"), /"AppClip" carries MARKETING_VERSION but is not in iosTargets/);
});

test("a literal CFBundleShortVersionString is caught", () => {
  // The measured bug: three MARKETING_VERSION values agreeing, the guard
  // green, and Settings showing 0.1 because one target spelled it out.
  const literal = YAML.replace(
    "        CFBundleShortVersionString: $(MARKETING_VERSION)\n  AppWidget:",
    "        CFBundleShortVersionString: '0.1'\n  AppWidget:",
  );
  const problems = versionProblems(readTargets(literal), NAMES);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"App" sets CFBundleShortVersionString to '0\.1'/);
});

test("a target that declares no MARKETING_VERSION at all is caught", () => {
  const dropped = YAML.replace('  AppWidget:\n    type: app-extension\n    settings:\n      base:\n        MARKETING_VERSION: "1.1.0"\n', "  AppWidget:\n    type: app-extension\n");
  const problems = versionProblems(readTargets(dropped), NAMES);
  assert.match(problems.join("\n"), /"AppWidget" carries no MARKETING_VERSION/);
});

test("writeVersion rewrites only the named targets, and says how many", () => {
  const { yaml, changed } = writeVersion(YAML, NAMES, "2.0.0");
  assert.equal(changed, 3);
  const targets = readTargets(yaml);
  for (const name of NAMES) assert.equal(targets.get(name).marketingVersion, "2.0.0");
  // Everything that is not the version is untouched.
  assert.equal(yaml.split("\n").length, YAML.split("\n").length);
  assert.ok(yaml.includes('CURRENT_PROJECT_VERSION: "1"'));
});

test("writeVersion leaves an unnamed target alone", () => {
  const extra = YAML.replace("  AppTests:\n    type: bundle.unit-test",
    '  AppTests:\n    type: bundle.unit-test\n    settings:\n      base:\n        MARKETING_VERSION: "9.9.9"');
  const { yaml, changed } = writeVersion(extra, NAMES, "2.0.0");
  assert.equal(changed, 3);
  assert.equal(readTargets(yaml).get("AppTests").marketingVersion, "9.9.9");
});
