import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The stack this project declares, held to what kyber says it should be.
 *
 * Three projects on the same stack drifted without anybody deciding to: the
 * sibling was testing its Firestore rules with a different TypeScript than its
 * app compiled with, and was running a firebase-tools from Homebrew while its
 * manifest declared another. Neither is a bug until the day it is, and nothing
 * was looking.
 *
 * `kyber/stack.json` is the declaration. This is the half that makes it bind:
 * the versions live in manifests, a catalog, workflows and project.yml, none of
 * which can read a JSON file in a submodule, so each copy is checked against it
 * by name.
 *
 * What is compared is the DECLARED string, not the resolved one. What actually
 * gets installed lives in each lockfile and Dependabot moves it; what this
 * holds is the intent, which is the thing that drifts silently.
 *
 * `required: false` marks a tool a consumer may legitimately not use — the
 * third app has no next-intl if it does not translate. A consumer that DOES
 * use one still has to match.
 *
 * ## `vite` is deliberately NOT here, and not in kyber either
 *
 * Decided by Cristian on 21/9/2026, after the sibling project reported that
 * the two repos resolve it a major apart: gastos on 7.3.6, stock on 8.2.1.
 *
 * It looks like exactly the drift this file exists to stop, and it is not.
 * Nobody declares vite in either repo: `vitest@5.0.1` asks for it as a PEER,
 * with `^6.4.0 || ^7.0.0 || ^8.0.0`. Two different resolutions of one open
 * range is what pnpm is supposed to do — there is no intent here to hold to,
 * which is the only thing this file compares.
 *
 * The alternative was declaring it. It was turned down because a key here is
 * a three-repo change by design (see kyber's versiones.md), and vite reaches
 * no artefact: `pnpm why vite -r` gives one version, two instances, and every
 * chain ends in devDependencies — vitest into `web`, `rules-tests` and
 * `gmail-bank-ingest`. The web is built by Next. What can differ is how the
 * tests run, not what is deployed.
 *
 * The risk being accepted, named: a test that depends on a difference between
 * vite 7 and 8 fails in one repo and passes in the other, and because CI is
 * what decides whether anything lands, it shows up as a red build in one
 * project with nothing in either tree explaining it. If that ever happens,
 * this paragraph is the explanation.
 *
 * And the inference that would kill this note, refuted in advance: running
 * `pnpm update vite -r` to line them up does NOT settle it. They would drift
 * again on the next lockfile anybody touches, because nothing couples them —
 * that is the whole point of it being an undeclared peer. Aligning without
 * coupling is a fix that expires by itself.
 *
 * Should it ever be declared after all, nothing extra is needed to notice.
 * Measured rather than assumed — `vite` planted in kyber/stack.json and the
 * file run: all three tests below go red, the first one naming it, "declares
 * these and nothing here says where they live". So the decision cannot be
 * reversed in one repo quietly; it has to be said here too.
 */
describe("the declared stack", () => {
  const ROOT = join(import.meta.dirname, "../../../..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
  const json = (p: string) => JSON.parse(read(p));

  const stack: Record<string, { value: string; required: boolean }> = json(
    "kyber/stack.json",
  );

  /**
   * Where each key is written HERE. Returning undefined means this project
   * does not declare it at all, which is only allowed when `required` is false.
   */
  const declared: Record<string, () => string | undefined> = {
    pnpm: () => /pnpm@(\S+)"/.exec(read("package.json"))?.[1],
    node: () => /node-version:\s*(\S+)/.exec(read(".github/workflows/ci.yml"))?.[1],
    java: () => /java-version:\s*(\S+)/.exec(read(".github/workflows/ci.yml"))?.[1],
    typescript: () => catalog("typescript"),
    vitest: () => catalog("vitest"),
    firebase: () => catalog("firebase"),
    "@types/node": () => catalog("'@types/node'"),
    "firebase-tools": () =>
      json("firebase/rules-tests/package.json").devDependencies?.["firebase-tools"],
    "firebase-admin": () => json("package.json").devDependencies?.["firebase-admin"],
    swift: () => /SWIFT_VERSION:\s*"([^"]+)"/.exec(read("apps/ios/project.yml"))?.[1],
    "firebase-ios-sdk": () => spmVersion("firebase-ios-sdk"),
    "GoogleSignIn-iOS": () => spmVersion("GoogleSignIn-iOS"),
    next: () => webDep("next"),
    react: () => webDep("react"),
    tailwindcss: () => webDep("tailwindcss"),
  };

  /** A `catalog:` entry in pnpm-workspace.yaml, comments and all. */
  function catalog(key: string): string | undefined {
    const line = new RegExp(`^\\s+${key.replace(/[$^]/g, "\\$&")}:\\s*(\\S+)`, "m");
    return line.exec(read("pnpm-workspace.yaml"))?.[1];
  }

  /** The `from:` of an SPM package in project.yml, matched by repo name. */
  function spmVersion(repo: string): string | undefined {
    const yml = read("apps/ios/project.yml");
    const at = yml.indexOf(repo);
    if (at === -1) return undefined;
    return /from:\s*(\S+)/.exec(yml.slice(at))?.[1];
  }

  function webDep(name: string): string | undefined {
    const pkg = json("apps/web/package.json");
    return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  }

  it("knows where every key kyber declares is written here", () => {
    // A key kyber adds that nothing here looks up would be silently unchecked,
    // which is the failure this whole file exists to stop happening one level
    // down. Adding it to kyber must break this until somebody says where it
    // lives — or that it lives nowhere.
    const unmapped = Object.keys(stack).filter(
      (k) => !k.startsWith("$") && declared[k] === undefined,
    );
    expect(
      unmapped,
      `kyber/stack.json declares these and nothing here says where they live:\n  ${unmapped.join("\n  ")}`,
    ).toEqual([]);
  });

  it("finds the values it claims to read", () => {
    // Every required key must resolve to SOMETHING. Without this, a regex that
    // stops matching — a manifest reformatted, a setting renamed — turns into
    // undefined, and undefined would sail through a comparison written the
    // obvious way.
    const blind = Object.entries(stack)
      .filter(([k, v]) => !k.startsWith("$") && v.required)
      .filter(([k]) => declared[k]() === undefined);
    expect(
      blind,
      `these are required and could not be found — the lookup is broken, not the version:\n  ${blind
        .map(([k]) => k)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("agrees with kyber on every version", () => {
    const wrong: string[] = [];
    for (const [key, { value, required }] of Object.entries(stack)) {
      if (key.startsWith("$")) continue;
      const here = declared[key]?.();
      if (here === undefined) {
        // Allowed only for optional tools: not using next-intl is a choice,
        // not a drift.
        if (required) wrong.push(`${key}: kyber says ${value}, not declared here`);
        continue;
      }
      if (here !== value) wrong.push(`${key}: kyber says ${value}, here ${here}`);
    }
    expect(
      wrong,
      `kyber/stack.json is what the three projects agreed on. Change it there,\n` +
        `not here, or say why this project differs:\n  ${wrong.join("\n  ")}`,
    ).toEqual([]);
  });
});
