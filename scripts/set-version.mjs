#!/usr/bin/env node
// Move every copy of the app's version at once.
//
// It lives in places that cannot read each other: the web app's package.json
// (which the framework config exposes to the bundle and the app shows in
// Settings) and MARKETING_VERSION once per iOS target — app, widget, watch.
// They had drifted before this existed, with the web on one number and iOS on
// another for the same product on the same day, which makes a screenshot of
// Settings useless for telling anybody which build somebody is on.
//
// Usage:  node scripts/set-version.mjs 1.2.3
//
// Reads from scripts/project.json: iosTargets (names), and optionally
// webManifest and iosProject when they are not in the usual place.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadProject } from "./lib/project.mjs";
import { ScriptError, run } from "./lib/errors.mjs";
import { readTargets, versionProblems, writeVersion } from "./lib/ios-version.mjs";

const SEMVER = /^\d+\.\d+\.\d+$/;

async function main() {
  const { root, config, dir } = loadProject({ required: [] });
  const targetNames = config.iosTargets;
  if (!Array.isArray(targetNames) || targetNames.length === 0) {
    throw new ScriptError(
      'scripts/project.json needs "iosTargets": the NAMES of the iOS targets that\n' +
        '  carry the version, e.g. ["App", "AppWidget", "AppWatch"]. Names and not a\n' +
        "  count, because a count survives a substitution: swap one target for\n" +
        "  another and the total is unchanged while the version moved.",
    );
  }

  const version = process.argv[2];
  // Refused rather than normalised: "v1.2" and "1.2" would each "work" and
  // then disagree with whatever the other file ended up with.
  if (version === undefined || !SEMVER.test(version)) {
    throw new ScriptError(
      "Usage: set-version <major.minor.patch>\n" +
        `  Got ${version === undefined ? "nothing" : `"${version}"`}. Three numbers, no prefix,\n` +
        '  no suffix — "1.0" and "v1.0.0" are both refused.',
    );
  }

  // Read and check EVERYTHING before writing anything.
  //
  // The first version of this script, in two projects independently, wrote the
  // web manifest and only then checked the iOS side — so a failed check left
  // the two platforms disagreeing, which is the exact state the script exists
  // to prevent, produced by the tool for preventing it. The order is simply
  // the one you write in.
  // Defaults, because both apps already put them here; a project that
  // does not can say so in the config rather than be told it is wrong.
  const manifestPath = config.webManifest
    ? dir("webManifest")
    : join(root, "apps", "web", "package.json");
  const projectPath = config.iosProject
    ? dir("iosProject")
    : join(root, "apps", "ios", "project.yml");
  const manifest = read(manifestPath);
  const project = read(projectPath);

  const currentWeb = /"version":\s*"([^"]+)"/.exec(manifest)?.[1];
  if (currentWeb === undefined) {
    throw new ScriptError(`No "version" field in ${manifestPath}. Refusing.`);
  }

  const targets = readTargets(project);
  const problems = versionProblems(targets, targetNames);
  if (problems.length > 0) {
    throw new ScriptError(
      `${relative(root, projectPath)} is not in the shape this can move safely:\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n  Nothing was written.",
    );
  }
  const currentIos = targets.get(targetNames[0]).marketingVersion;

  const { yaml, changed } = writeVersion(project, targetNames, version);
  if (changed !== targetNames.length) {
    throw new ScriptError(
      `Would have rewritten ${changed} of ${targetNames.length} targets. Nothing was written.`,
    );
  }
  // A targeted replace, so a manifest that is not formatted the way a JSON
  // round trip would format it comes back unchanged apart from the version.
  writeFileSync(manifestPath, manifest.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`));
  writeFileSync(projectPath, yaml);

  console.log(`web  ${currentWeb} -> ${version}   ${relative(root, manifestPath)}`);
  console.log(
    `iOS  ${currentIos} -> ${version}   ${relative(root, projectPath)} ` +
      `(${targetNames.join(", ")})`,
  );
  // Stopping one step short is the easy failure and it has two shapes. Without
  // the generator, the version is right in the project file and wrong in the
  // bundle, so the guard passes and the phone shows the old number. Without
  // --follow-tags the tag stays local, which is believing you tagged. Neither
  // can be done from here — one needs a tool CI does not have, the other
  // publishes — so the least this can do is not let you forget them.
  console.log(`
Next, in this order:
  cd ${relative(root, projectPath).replace(/\/[^/]+$/, "")} && xcodegen   # the Info.plist files are generated
  git commit -am "chore: v${version}"
  git tag -a v${version} -m "v${version}"
  git push --follow-tags                # without this the tag stays local`);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new ScriptError(`Cannot read ${path}: ${error.message}`);
  }
}

run(main, {
  usage: "Usage: node scripts/set-version.mjs <major.minor.patch>",
  operands: 1,
});
