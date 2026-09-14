import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

  it("is checked out at all", () => {
    // Everything below reads files inside the submodule, and a missing
    // submodule makes all of it vacuous rather than red: `git grep` skips a
    // directory it cannot descend into and reports nothing, which reads
    // exactly like nothing being wrong.
    //
    // `pnpm install` does not fetch submodules, so a fresh clone or a pull
    // that first brought the gitlink lands here.
    expect(
      existsSync(join(ROOT, "kyber/package.json")),
      "the kyber submodule is not checked out — run `git submodule update --init`",
    ).toBe(true);
  });

  it("carries none of this project's identity", () => {
    // kyber is shared by three projects, so anything naming this one is a copy
    // that the other two would inherit. Ports included: the shared prose does
    // not name a port, because a rule that needs a concrete port to be
    // understood is still tied to the artefact it came from.
    //
    // This lives here, and NOT in emulator-ports.test.ts's sweep, on purpose.
    // That sweep would report the file as repeating a port with nothing
    // holding it to the source — a failure in this repo, fixed in another
    // one, phrased as if a copy had drifted. Failing is not enough; it has to
    // fail in the right place.
    //
    // (Nor can this comment spell a port out. The sweep reads every file that
    // is not on its list, including this one, so quoting its message verbatim
    // put this file on the list it describes. That happened, here, while
    // writing the paragraph above.)
    // The ports come from firebase.json rather than being spelled out. Not
    // tidiness: emulator-ports.test.ts sweeps the tree for files repeating a
    // port with nothing holding them to it, and a literal here put THIS file
    // on that list. A guard about ports that hardcodes one fails on itself,
    // which is the right way round.
    const emulators = JSON.parse(read(join(config.firebaseDir, "firebase.json")))
      .emulators as Record<string, { port?: number; websocketPort?: number }>;
    const ports = Object.values(emulators).flatMap((e) =>
      [e?.port, e?.websocketPort].filter((p) => typeof p === "number").map(String),
    );
    expect(ports.length, "no ports found in firebase.json").toBeGreaterThan(3);

    const needles = [config.projectId, config.rulesTestsProjectId, ...ports];
    const hits = needles.flatMap((needle) => {
      try {
        return execFileSync("git", ["grep", "-nI", "-e", needle], {
          cwd: join(ROOT, "kyber"),
          encoding: "utf8",
        })
          .split("\n")
          .filter((l) => l !== "");
      } catch {
        // git grep exits 1 when nothing matches, which is the good case.
        return [];
      }
    });
    expect(
      [...new Set(hits)],
      `kyber is shared by three projects and must not name this one:\n${[...new Set(hits)].join("\n")}`,
    ).toEqual([]);
  });

  it("is imported by CLAUDE.md, and every one of those resolves", () => {
    // Claude Code resolves `@path` imports relative to the file, and a path
    // that does not exist is simply not imported — no warning, no error. So an
    // agent working in a checkout without the submodule would run without the
    // shared rules and have no way to tell. Nothing else in this repo notices.
    const claude = read("CLAUDE.md");
    const imports = [...claude.matchAll(/^@(\S+)$/gm)].map((m) => m[1]);
    expect(imports.length, "CLAUDE.md imports nothing from kyber").toBeGreaterThan(
      3,
    );
    const missing = imports.filter((path) => !existsSync(join(ROOT, path)));
    expect(missing, `CLAUDE.md imports files that do not exist:\n${missing.join("\n")}`)
      .toEqual([]);

    // Links in reglas.md are the same hazard with a different renderer: a dead
    // relative link is a 404 nobody clicks until they need the rule.
    const reglas = read("docs/reglas.md");
    const links = [...reglas.matchAll(/\]\((\.\.\/kyber\/[^)]+)\)/g)].map((m) => m[1]);
    expect(links.length, "reglas.md points at nothing in kyber").toBeGreaterThan(3);
    const dead = links.filter((rel) => !existsSync(join(ROOT, "docs", rel)));
    expect(dead, `docs/reglas.md links to files that do not exist:\n${dead.join("\n")}`)
      .toEqual([]);
  });

  it("is reachable from the scripts and the tests, and from nothing the bundle ships", () => {
    // Vercel cannot fetch a private submodule, and no permission changes that.
    // Its own docs: submodules deploy "as long as the submodule is publicly
    // accessible through the HTTP protocol. Git submodules that are private or
    // requested over SSH will fail during the Build step." The deploy still
    // goes GREEN — the clone reports one `Warning: Failed to fetch one or more
    // git submodules` line and the build carries on without it.
    //
    // So kyber/ is absent in production and present everywhere else: CI checks
    // it out with a deploy key, and scripts, hooks and these tests run on a
    // machine where it exists. Nothing is broken while the bundle imports none
    // of it — which is also why nothing would notice the day it does. The
    // import would resolve locally, pass CI, deploy green, and fail in the
    // browser with a cause weeks old.
    //
    // If the bundle ever genuinely needs code from kyber, the submodule is the
    // wrong shape for it: make kyber public, or depend on it as a git package,
    // which Vercel does support. Do not "fix" this guard.
    const sources = execFileSync(
      "git",
      ["ls-files", "apps/web/src", "apps/web/next.config.ts"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.tsx?$/.test(f));

    // Without this the filter below would sweep an empty list and pass — the
    // shape that has already let a deleted guard sit green in this repo.
    expect(sources.length, "found no bundled sources to check").toBeGreaterThan(50);

    const reaching = sources.filter((file) =>
      /(?:^|\n)\s*(?:import|export)[^\n]*["'][^"'\n]*kyber|require\(\s*["'][^"'\n]*kyber|@(?:import|source)[^\n]*kyber/.test(
        read(file),
      ),
    );
    expect(
      reaching,
      "these ship to the browser and reach into kyber, which production does " +
        `not have:\n  ${reaching.join("\n  ")}`,
    ).toEqual([]);

    // The other way in: an alias that lands inside kyber without naming it.
    const tsconfig = read("apps/web/tsconfig.json").replace(/^\s*\/\/.*$/gm, "");
    const paths: Record<string, string[]> =
      JSON.parse(tsconfig).compilerOptions?.paths ?? {};
    const aliased = Object.entries(paths).filter(([, targets]) =>
      targets.some((t) => t.includes("kyber")),
    );
    expect(
      aliased.map(([k]) => k),
      "a tsconfig path alias resolves into kyber, which production does not have",
    ).toEqual([]);
  });

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
