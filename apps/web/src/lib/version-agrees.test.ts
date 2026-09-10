import { describe, expect, it } from "vitest";
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

  it("is the same everywhere", () => {
    for (const [index, value] of IOS.entries()) {
      expect(
        value,
        `project.yml target #${index + 1} says ${value}, the web says ${WEB}`,
      ).toBe(WEB);
    }
  });
});
