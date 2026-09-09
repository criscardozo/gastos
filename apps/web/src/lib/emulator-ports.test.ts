import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import config from "../../../../firebase/firebase.json";

/**
 * The emulator ports, held to the one file that decides them.
 *
 * `firebase/firebase.json` is what `pnpm emulators` reads, and SIX other
 * places have to agree with it because none of them can read it: the web
 * client, the Playwright config, the e2e spec's REST base, the seed script,
 * iOS's `configureEmulatorsIfRequested()`, and CI's `wait-on`.
 *
 * The count was five when this was written, and the sixth is why the count is
 * worth distrusting: CI waited on the old pair, sat for the full two minutes
 * and reported "Timed out waiting for: tcp:9099, tcp:8080" — which is exactly
 * what a slow emulator looks like, while the emulator was up and listening
 * elsewhere. A guard that says "every copy" has to be told about every copy.
 *
 * Moving the ports proved why this is needed. Four of the five were updated
 * and the e2e spec's own defaults were not, so 15 of 18 tests failed with
 * `Cannot read properties of undefined (reading 'find')` — a REST call to a
 * port an SSH forward happens to hold, answering with something that has no
 * `documents`. Nothing about that error says "port".
 *
 * Why not the defaults at all: on this machine SSH forwards hold 4000, 8080,
 * 8085, 9099, 9150 and 9199 — Firebase's entire default set — and 8085 is the
 * `stock` project's Firestore. The defaults never bind here.
 */

const ROOT = join(import.meta.dirname, "../../../..");
const AUTH = String(config.emulators.auth.port);
const FIRESTORE = String(config.emulators.firestore.port);
const WEBSOCKET = String(config.emulators.firestore.websocketPort);
const UI = String(config.emulators.ui.port);
const HUB = String(config.emulators.hub.port);
const LOGGING = String(config.emulators.logging.port);

/**
 * Prose is a copy too — and for four of these six it is the ONLY other copy.
 *
 * Everything above this line checks code. Measured by mutation, that leaves a
 * hole: move `auth` in firebase.json and five tests fail, but move the UI, the
 * hub, the logging or the websocket port and all eight still pass. No code
 * default repeats those four. They live in firebase.json and in sentences.
 *
 * The class is narrower than "the docs go stale". A comment that was WRONG
 * when written is caught by measuring once; these were RIGHT when written and
 * stopped being right when the block moved, which no amount of care at writing
 * time prevents. The spec header two files over claimed 9099/8080 for two days
 * after the code changed. (The Stock session found the same hole in its own
 * ports guard, from the same measurement, and swept two more out of its docs.)
 *
 * Each file lists the ports it actually names, not all six, because a guard
 * that demands more than a file claims gets loosened until it means nothing.
 * `docs/reglas.md` is deliberately absent: it narrates what the ports used to
 * be, so pinning it would forbid writing history down.
 */
const DOCUMENTED: readonly (readonly [string, readonly string[]])[] = [
  ["CLAUDE.md", [AUTH, FIRESTORE, WEBSOCKET, UI, HUB, LOGGING]],
  ["README.md", [AUTH, FIRESTORE, UI]],
  ["apps/ios/README.md", [AUTH, FIRESTORE]],
];

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("every copy of the emulator ports", () => {
  it("has ports to check in the first place", () => {
    // A config that stopped declaring them would make every assertion below
    // compare undefined to undefined.
    expect(Number(AUTH)).toBeGreaterThan(1024);
    expect(Number(FIRESTORE)).toBeGreaterThan(1024);
  });

  it.each([
    ["the web client", "apps/web/src/lib/firebase/client.ts"],
    ["the Playwright config", "apps/web/playwright.config.ts"],
    ["the e2e spec", "apps/web/e2e/app.spec.ts"],
  ])("agrees with firebase.json — %s", (_label, path) => {
    const text = read(path);
    expect(text).toContain(`?? "${AUTH}"`);
    expect(text).toContain(`?? "${FIRESTORE}"`);
  });

  it("agrees with firebase.json — CI's wait-on", () => {
    // The one that got missed. It has no env override: the workflow starts the
    // emulator from the same firebase.json and then waits on literals.
    expect(read(".github/workflows/ci.yml")).toContain(
      `wait-on tcp:${AUTH} tcp:${FIRESTORE}`,
    );
  });

  it("agrees with firebase.json — the restore script", () => {
    // Added after it was found still defaulting to Firebase's 8080, which on
    // this machine is an SSH forward to somebody else's emulator. It was
    // missed because the guard was written from a list of files somebody
    // remembered, and restore.mjs is the one nobody runs.
    expect(read("scripts/restore.mjs")).toContain(`127.0.0.1:${FIRESTORE}`);
  });

  it("agrees with firebase.json — the seed script", () => {
    // No env override here: it talks to the emulator or to nothing.
    expect(read("scripts/seed-emulator.mjs")).toContain(FIRESTORE);
  });

  it("agrees with firebase.json — iOS", () => {
    const swift = read("apps/ios/Gastos/Services/FirestoreService.swift");
    expect(swift).toContain(`port: ${AUTH}`);
    expect(swift).toContain(`settings.host = "localhost:${FIRESTORE}"`);
  });

  it.each(DOCUMENTED.map((d) => [d[0], d[1]] as const))(
    "agrees with firebase.json — the prose in %s",
    (path, ports) => {
      const text = read(path);
      for (const port of ports) expect(text, `${path} must name :${port}`).toContain(port);
    },
  );

  it("has no port in firebase.json that nothing documents", () => {
    // The completeness half. Adding a seventh port to the config should fail
    // here until somebody decides which sentence explains it, because the
    // lesson of the `wait-on` was that a guard saying "every copy" has to be
    // told what every copy is — and the number you believe is the one to
    // distrust.
    const declared = [
      ...JSON.stringify(config.emulators).matchAll(/"(?:websocketPort|port)":(\d+)/g),
    ].map((m) => m[1]);
    expect(declared.length).toBe(6);
    const documented = new Set(DOCUMENTED.flatMap((d) => d[1]));
    for (const port of declared) {
      expect(documented, `:${port} is in firebase.json but in no prose`).toContain(port);
    }
  });

  it("is nowhere still on Firebase's defaults", () => {
    // Those are the ports SSH forwards hold, so a leftover copy does not fail
    // loudly — it connects to a forward and gets an answer that is not
    // Firestore's.
    for (const path of [
      "apps/web/src/lib/firebase/client.ts",
      "apps/web/playwright.config.ts",
      "apps/web/e2e/app.spec.ts",
      "scripts/seed-emulator.mjs",
      "scripts/restore.mjs",
      "apps/ios/Gastos/Services/FirestoreService.swift",
      ".github/workflows/ci.yml",
    ]) {
      expect(read(path), path).not.toMatch(/\?\? "(9099|8080)"/);
      expect(read(path), path).not.toMatch(/localhost:8080|port: 9099/);
      expect(read(path), path).not.toMatch(/tcp:9099|tcp:8080/);
    }
  });
});
