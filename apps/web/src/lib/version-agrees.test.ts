import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One version number, in every file that states it.
 *
 * It lives in four places that cannot read each other: this package's
 * `package.json` — which `next.config.ts` exposes as NEXT_PUBLIC_APP_VERSION,
 * shown in Ajustes and on the crash screen — and `project.yml`'s
 * MARKETING_VERSION three times, for the app, the widget and the watch app.
 *
 * They had already drifted before anybody looked: the web said 0.1.0 and iOS
 * said 1.0.0 for the same product on the same day. That is worse than having
 * no version at all, because both screens answer confidently and a screenshot
 * of one says nothing about the other.
 *
 * Move them with `node scripts/set-version.mjs <x.y.z>`, never by hand.
 */
describe("the app version", () => {
  const ROOT = join(import.meta.dirname, "../../../..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  const WEB = /"version":\s*"([^"]+)"/.exec(read("apps/web/package.json"))?.[1];
  const IOS = [
    ...read("apps/ios/project.yml").matchAll(/MARKETING_VERSION: "([^"]+)"/g),
  ].map((m) => m[1]);

  it("is stated at all, and by every target", () => {
    // Without this the comparison below would hold undefined against an empty
    // list and pass — and a target added later that forgot the key would only
    // surface as a wrong number in the watch app's Ajustes.
    expect(WEB, "apps/web/package.json has no version").toBeDefined();
    expect(IOS, "project.yml should carry app, widget and watch").toHaveLength(3);
  });

  it("is semver, not something that looks like it", () => {
    // "v1.2" and "1.2.0" both read as a version to a human and sort
    // differently everywhere else.
    for (const value of [WEB as string, ...IOS]) {
      expect(value).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("knows which package.json files are NOT the app's version", () => {
    // The other manifests carry numbers and must never be dragged into this.
    //
    // `design-system/package.json` sits at 0.1.0 — the exact string the web
    // app had until today — and `tools/gmail-bank-ingest` at 0.0.0. Neither is
    // shown anywhere; they are private manifests that exist so pnpm has
    // something to install against. The hazard is the obvious tidy-up: run
    // `grep '"version"'`, find them, "sync" them, and now there are three more
    // copies to keep in step forever.
    //
    // So they are listed as deliberately absent, and a NEW manifest with a
    // version fails here until somebody says which kind it is. The Stock
    // session raised this: a copy that deliberately does not participate has
    // to be written down as such, or the guard teaches the opposite of what
    // it means.
    const NOT_THE_APP = [
      "design-system/package.json",
      "tools/gmail-bank-ingest/package.json",
      "firebase/rules-tests/package.json",
      "package.json",
    ];
    const manifests = execFileSync("git", ["ls-files", "*package.json"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f !== "" && !f.includes("node_modules"));

    expect(manifests.length, "no manifests found at all").toBeGreaterThan(3);
    const unknown = manifests.filter(
      (f) => f !== "apps/web/package.json" && !NOT_THE_APP.includes(f),
    );
    expect(
      unknown,
      `these carry a version and nothing says whether it is the app's:\n  ${unknown.join("\n  ")}`,
    ).toEqual([]);
  });

  it("is the same everywhere", () => {
    for (const [index, value] of IOS.entries()) {
      expect(
        value,
        `project.yml target #${index + 1} says ${value}, the web says ${WEB}`,
      ).toBe(WEB);
    }
  });
});
