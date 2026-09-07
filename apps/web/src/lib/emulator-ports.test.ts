import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import config from "../../../../firebase/firebase.json";

/**
 * The emulator ports, held to the one file that decides them.
 *
 * `firebase/firebase.json` is what `pnpm emulators` reads, and five other
 * places have to agree with it because none of them can read it: the web
 * client, the Playwright config, the e2e spec's REST base, the seed script and
 * iOS's `configureEmulatorsIfRequested()`.
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

  it("agrees with firebase.json — the seed script", () => {
    // No env override here: it talks to the emulator or to nothing.
    expect(read("scripts/seed-emulator.mjs")).toContain(FIRESTORE);
  });

  it("agrees with firebase.json — iOS", () => {
    const swift = read("apps/ios/Gastos/Services/FirestoreService.swift");
    expect(swift).toContain(`port: ${AUTH}`);
    expect(swift).toContain(`settings.host = "localhost:${FIRESTORE}"`);
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
      "apps/ios/Gastos/Services/FirestoreService.swift",
    ]) {
      expect(read(path), path).not.toMatch(/\?\? "(9099|8080)"/);
      expect(read(path), path).not.toMatch(/localhost:8080|port: 9099/);
    }
  });
});
