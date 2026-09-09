import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import config from "../../../../firebase/firebase.json";

/**
 * The emulator ports, held to the one file that decides them.
 *
 * `firebase/firebase.json` is what `pnpm emulators` reads, and a number of
 * other places have to agree with it because none of them can read it. The
 * list is COPIES and DOCUMENTED below; there is deliberately no count in this
 * sentence.
 *
 * There was one. It said five, then six, and it was wrong both times within
 * days — the Stock session hit the identical thing, a header saying "nine
 * other files" inside the file whose whole job is keeping numbers true. A
 * count in prose is one more copy to maintain, and the list is the count.
 *
 * The reason to distrust it at all: CI once waited on the old pair, sat for
 * the full two minutes and reported "Timed out waiting for" the ports it had
 * been given — which is exactly what a slow emulator looks like, while the
 * emulator was up and listening elsewhere. A guard that says "every copy" has
 * to be told what every copy is, and told again every time one appears, which
 * is what "knows about every file that repeats a port" is for.
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
 *
 * These tests were absent for one commit. Restructuring this file around a
 * single COPIES list replaced a range of it by index and took the prose
 * `it.each` with it — the count went from 15 to 11, the suite stayed green,
 * and the commit message said the prose was covered. Nothing caught it
 * because the sweep below only asks whether a file is ACCOUNTED FOR, and
 * these files still were; what vanished was the part that reads them. Found
 * by mutating a port in docs/reglas.md and watching nothing fail.
 */
const DOCUMENTED: readonly (readonly [string, readonly string[]])[] = [
  ["CLAUDE.md", [AUTH, FIRESTORE, WEBSOCKET, UI, HUB, LOGGING]],
  ["README.md", [AUTH, FIRESTORE, UI]],
  ["apps/ios/README.md", [AUTH, FIRESTORE]],
  // Narrates the port move — including the OLD numbers, which is the point of
  // the entry — but it also states the current block in full, and that half
  // goes stale like any other copy.
  //
  // It used to be excluded from the sweep wholesale, on the strength of the
  // narration. That exclusion was right about one thing and quietly covered a
  // second I had never checked: six live ports sitting in a paragraph, in the
  // file that explains that sentences about ports go stale. The Stock session
  // found the identical thing inside its own guard twenty minutes after
  // refusing a per-line exception elsewhere — neither of us evaluated the
  // exception, we just wrote it as housekeeping.
  //
  // Nothing is excluded from the sweep now except firebase.json, which is the
  // source rather than a copy.
  ["docs/reglas.md", [AUTH, FIRESTORE, WEBSOCKET, UI, HUB, LOGGING]],
];

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/**
 * Every file of CODE that repeats a port, and what it must contain.
 *
 * Declared once and used twice: to check each copy agrees, and to check the
 * list itself has not fallen behind the repo. Those are different claims —
 * see "knows about every file that repeats a port" below.
 */
const COPIES: readonly (readonly [string, string, (t: string) => void])[] = [
  ...(
    [
      ["the web client", "apps/web/src/lib/firebase/client.ts"],
      ["the Playwright config", "apps/web/playwright.config.ts"],
      ["the e2e spec", "apps/web/e2e/app.spec.ts"],
    ] as const
  ).map(
    ([label, path]) =>
      [
        label,
        path,
        (t: string) => {
          expect(t).toContain(`?? "${AUTH}"`);
          expect(t).toContain(`?? "${FIRESTORE}"`);
        },
      ] as const,
  ),
  [
    // The one that got missed first. No env override: the workflow starts the
    // emulator from the same firebase.json and then waits on literals.
    "CI's wait-on",
    ".github/workflows/ci.yml",
    (t) => expect(t).toContain(`wait-on tcp:${AUTH} tcp:${FIRESTORE}`),
  ],
  [
    // Found still on Firebase's 8080, which here is an SSH forward to somebody
    // else's emulator. Missed because the list was written from memory, and
    // this is the script nobody runs by hand.
    "the restore script",
    "scripts/restore.mjs",
    (t) => expect(t).toContain(`127.0.0.1:${FIRESTORE}`),
  ],
  [
    // Kept 8080 through the port move, so the one rehearsal standing behind
    // every backup was aimed at another project's database.
    "the round-trip rehearsal",
    "firebase/rules-tests/seed-for-restore.mjs",
    (t) => expect(t).toContain(`127.0.0.1:${FIRESTORE}`),
  ],
  [
    // No env override here: it talks to the emulator or to nothing.
    "the seed script",
    "scripts/seed-emulator.mjs",
    (t) => expect(t).toContain(FIRESTORE),
  ],
  [
    "iOS",
    "apps/ios/Gastos/Services/FirestoreService.swift",
    (t) => {
      expect(t).toContain(`port: ${AUTH}`);
      expect(t).toContain(`settings.host = "localhost:${FIRESTORE}"`);
    },
  ],
];

describe("every copy of the emulator ports", () => {
  it("has ports to check in the first place", () => {
    // A config that stopped declaring them would make every assertion below
    // compare undefined to undefined.
    expect(Number(AUTH)).toBeGreaterThan(1024);
    expect(Number(FIRESTORE)).toBeGreaterThan(1024);
  });

  it.each(COPIES.map((c) => [c[0], c[1], c[2]] as const))(
    "agrees with firebase.json — %s",
    (_label, path, check) => {
      check(read(path));
    },
  );

  it.each(DOCUMENTED.map((d) => [d[0], d[1]] as const))(
    "agrees with firebase.json — the prose in %s",
    (path, ports) => {
      const text = read(path);
      for (const port of ports) {
        expect(text, `${path} must name :${port}`).toContain(port);
      }
    },
  );

  it("knows about every file that repeats a port", () => {
    // The completeness half, and the one the rest of this file cannot supply.
    //
    // Every assertion above is written against a hand-listed path, so together
    // they prove that what the list NAMES agrees — not that the list names
    // everything. Those are different claims, and the weaker one passes right
    // up until somebody adds a copy. The Stock session ran this exact check on
    // its own guard and found two: `expect.poll` calls added the week before,
    // each carrying its own port default, neither on the list. The guard
    // written to stop the ports drifting had drifted from itself.
    //
    // So this walks the tree instead. Any file that mentions a port and is not
    // accounted for fails, by name.
    const accounted = new Set([
      // The source. Everything else is a copy of it, and it is the only
      // thing this sweep excuses.
      "firebase/firebase.json",
      ...COPIES.map(([, path]) => path),
      ...DOCUMENTED.map(([path]) => path),
    ]);

    for (const port of [AUTH, FIRESTORE, WEBSOCKET, UI, HUB, LOGGING]) {
      let files: string[] = [];
      try {
        // `-w`, because a port is a whole number and not four digits sitting
        // inside something longer. Without it the hub's port matched a
        // revision hash in Package.resolved and this reported a copy that is
        // not one — and a guard that cries wolf gets an exclusion list bolted
        // on, after which it is the exclusion list that goes stale.
        //
        // This file is deliberately NOT in `accounted`, which is why the
        // sentence above cannot spell the number out. That is the right way
        // round: a guard holding the ports must never hardcode one, so the
        // moment it does, it fails on itself.
        files = execFileSync("git", ["grep", "-wlI", port], {
          cwd: ROOT,
          encoding: "utf8",
        })
          .split("\n")
          .filter((f) => f !== "");
      } catch {
        // No match at all means the port vanished from the repo, which the
        // "has ports to check" test above would not notice either.
        expect.fail(`no file mentions :${port} — not even firebase.json`);
      }
      const unknown = files.filter((f) => !accounted.has(f));
      expect(
        unknown,
        `these repeat :${port} and nothing holds them to it:\n  ${unknown.join("\n  ")}`,
      ).toEqual([]);
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
      "firebase/rules-tests/seed-for-restore.mjs",
      "apps/ios/Gastos/Services/FirestoreService.swift",
      ".github/workflows/ci.yml",
    ]) {
      expect(read(path), path).not.toMatch(/\?\? "(9099|8080)"/);
      expect(read(path), path).not.toMatch(/localhost:8080|port: 9099/);
      expect(read(path), path).not.toMatch(/tcp:9099|tcp:8080/);
    }
  });
});
