import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `.kyber/config.json` is what the shared scripts read instead of holding
 * this project's constants themselves.
 *
 * Three projects on the same stack (Gastos, Stock, and a third) had drifted
 * into separate copies of the same tooling — `check-rules-drift.mjs` is byte
 * for byte identical across two of them apart from one project id, and the
 * SAME write-before-validate bug was found twice, separately, in two copies
 * of `set-version.mjs`. The tooling moves to the `kyber` submodule and the
 * things that are genuinely ours stay here, in one file.
 *
 * A config that nothing reads is just another copy, so this holds it to the
 * places that cannot read it: the rules-test helper names its project id as a
 * literal, and `pnpm emulators` names the emulator's on the command line.
 * Declaring a value here and leaving those unchanged is exactly the drift the
 * move is meant to end.
 *
 * The submodule's own checks (that `kyber/` is initialised at all, that every
 * `@kyber/...` import in CLAUDE.md resolves) arrive with the submodule.
 */
describe("the kyber consumer config", () => {
  const ROOT = join(import.meta.dirname, "../../../..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
  const config = JSON.parse(read(".kyber/config.json"));

  it("states every key the first batch of shared scripts reads", () => {
    // Without this the assertions below would compare undefined against
    // undefined and pass — a missing key would read as agreement.
    for (const key of [
      "name",
      "projectId",
      "rulesTestsProjectId",
      "emulatorProjectId",
      "firebaseDir",
      "rulesTestsDir",
    ]) {
      expect(config[key], `.kyber/config.json has no ${key}`).toBeTypeOf("string");
      expect(config[key], `.kyber/config.json has an empty ${key}`).not.toBe("");
    }
  });

  it("points at directories that are actually there", () => {
    // A wrong path here surfaces inside a shared script as a missing file
    // with a path nobody recognises, one repo away from the mistake.
    expect(() => read(join(config.firebaseDir, "firebase.json"))).not.toThrow();
    expect(() => read(join(config.rulesTestsDir, "package.json"))).not.toThrow();
  });

  it("names the project id the rules tests actually connect to", () => {
    // `firebase/rules-tests/tests/helpers.ts` writes it as a literal, because
    // initializeTestEnvironment takes it as an argument and cannot read this.
    // That copy is the one that decides which namespace the tests run in.
    const helpers = read(join(config.rulesTestsDir, "tests/helpers.ts"));
    expect(
      helpers,
      `helpers.ts must use projectId: "${config.rulesTestsProjectId}"`,
    ).toContain(`projectId: "${config.rulesTestsProjectId}"`);
  });

  it("names the project id the emulator is started under", () => {
    // Not a detail: under any other id the rules resolve isMember()'s get()
    // in a namespace with no household, which is an evaluation error, and
    // every subcollection reads back empty with no error at all.
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.emulators).toContain(`--project ${config.emulatorProjectId}`);
  });

  it("keeps the legacy restore path switched on, and says why", () => {
    // Backups taken between 17/7 and 9/9 2026 flatten Timestamps to bare ISO
    // strings, so restoring one depends on the `*At` naming convention. New
    // dumps tag the type instead and the heuristic is off for them. This flag
    // is what keeps those older files readable; Stock and the third app never
    // wrote that format and must not have the path at all.
    expect(config.restore?.legacyIsoTimestamps).toBe(true);
  });
});
