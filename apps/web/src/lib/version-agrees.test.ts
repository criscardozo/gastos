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

  it("has a git tag, because a version with nothing to check out is a number", () => {
    // The four copies can agree perfectly and still leave nothing to go back
    // to. A tag is what makes a version a thing rather than a string: it is
    // what `git checkout v1.1.0` needs, what a bisect walks, and what tells you
    // which commit the phone is running when Ajustes says 1.1.0 and the bug
    // report is a week old.
    //
    // It was being done by hand — v1.0.0 and v1.1.0 both exist, annotated and
    // pushed — which is to say it depended on somebody remembering, and the
    // script that moves the four copies never mentioned git at all.
    //
    // Flow: `node scripts/set-version.mjs x.y.z`, commit, `git tag -a vx.y.z`,
    // `git push --follow-tags`. Forget the tag and this goes red.
    const tags = execFileSync("git", ["tag", "-l"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((t) => t !== "");

    // Told apart on purpose: no tags AT ALL is a shallow checkout, and
    // reporting that as "this version is untagged" sends you to tag something
    // that is already tagged. CI passes fetch-tags for this reason.
    expect(
      tags.length,
      "no tags in this checkout at all — it is shallow, not untagged",
    ).toBeGreaterThan(0);

    expect(
      tags,
      `${WEB} is declared everywhere and has no tag. Commit, then:\n` +
        `  git tag -a v${WEB} -m "v${WEB}" && git push --follow-tags`,
    ).toContain(`v${WEB}`);
  });

  it("is what the plist key actually reads, in every target", () => {
    // MARKETING_VERSION is a build setting. The number a person SEES comes
    // from CFBundleShortVersionString, and nothing forces one to reference
    // the other — a target can set the key to a literal and the setting goes
    // nowhere.
    //
    // The Stock session hit exactly that: its three MARKETING_VERSIONs agreed
    // at 1.0.0, its version guard was green, and the app on the phone showed
    // 0.1, because the app target's plist key was the literal '0.1'. The
    // guard measured the setting, not the connection to the screen.
    //
    // So both ends are checked: the yml that declares the key, and the three
    // tracked Info.plists it generates. Every one must DEFER to the setting.
    const DEFERS = "$(MARKETING_VERSION)";
    const yml = read("apps/ios/project.yml");

    const keys = [...yml.matchAll(/CFBundleShortVersionString:\s*(.+)/g)].map(
      (m) => m[1].trim(),
    );
    expect(
      keys,
      "every target that carries a MARKETING_VERSION must also state the key",
    ).toHaveLength(IOS.length);
    for (const value of keys) {
      expect(value, `project.yml pins the shown version to ${value}`).toBe(DEFERS);
    }

    const plists = execFileSync("git", ["ls-files", "apps/ios/*/Info.plist"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f !== "");
    expect(plists, "app, widget and watch each have one").toHaveLength(IOS.length);
    for (const path of plists) {
      const shown = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(
        read(path),
      )?.[1];
      expect(shown, `${path} pins the shown version to ${shown}`).toBe(DEFERS);
    }
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
