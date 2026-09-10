#!/usr/bin/env node
// Set the app version everywhere at once.
//
// It lives in four places that cannot read each other: apps/web/package.json
// (which next.config.ts exposes as NEXT_PUBLIC_APP_VERSION, shown in Ajustes
// and on the crash screen) and project.yml's MARKETING_VERSION three times,
// once each for the app, the widget and the watch app.
//
// Before this they had drifted: the web said 0.1.0 and iOS said 1.0.0 for the
// same product on the same day, which makes a screenshot of Ajustes useless
// for telling anybody which build you are on. `version-agrees.test.ts` holds
// them together now; this is the way to move them without doing it by hand.
//
// Usage:  node scripts/set-version.mjs 1.1.0

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const next = process.argv[2];

// Refused rather than normalised: "v1.2" and "1.2" would both "work" and then
// disagree with whatever the other file got.
if (next === undefined || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error("Usage: node scripts/set-version.mjs <major.minor.patch>");
  process.exit(1);
}

const pkgPath = join(root, "apps/web/package.json");
const pkg = readFileSync(pkgPath, "utf8");
const current = /"version":\s*"([^"]+)"/.exec(pkg)?.[1];
writeFileSync(pkgPath, pkg.replace(/"version":\s*"[^"]+"/, `"version": "${next}"`));

const ymlPath = join(root, "apps/ios/project.yml");
const yml = readFileSync(ymlPath, "utf8");
const marketing = /MARKETING_VERSION: "[^"]+"/g;
const found = yml.match(marketing)?.length ?? 0;
// The count is asserted, not assumed: a target added later would silently keep
// the old version and only show up as a wrong number in Ajustes on the watch.
if (found !== 3) {
  console.error(`Expected 3 MARKETING_VERSION lines in project.yml, found ${found}.`);
  process.exit(1);
}
writeFileSync(ymlPath, yml.replace(marketing, `MARKETING_VERSION: "${next}"`));

console.log(`${current ?? "?"} → ${next}`);
console.log("  apps/web/package.json");
console.log("  apps/ios/project.yml (app, widget, watch)");
console.log("\nRun `cd apps/ios && xcodegen` so the Info.plists pick it up.");
