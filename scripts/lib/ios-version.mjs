// Reading version settings out of an XcodeGen project.yml, by TARGET NAME.
//
// Deliberately a targeted line scan and not a YAML parser: kyber installs
// nothing, and the shape being read is two levels of a file this project
// generates its Xcode project from. It fails loudly when the shape is not what
// it expects rather than guessing.
//
// Why by name and not by count — this is the whole point of the file. Both
// consumers asserted `found.length === 3`, and a count survives a
// substitution: add one target and remove another and it is still three, while
// the version is now written somewhere nobody meant and missing where somebody
// expected it. A total answers "how many" to a question that was "which ones".

import { KyberError } from "./errors.mjs";

const MARKETING = /^\s*MARKETING_VERSION:\s*"?([^"\n]*)"?\s*$/;
const SHORT_VERSION = /^\s*CFBundleShortVersionString:\s*(.+?)\s*$/;

/**
 * The targets in a project.yml and the version settings each one carries.
 *
 * Returns a Map of target name to `{ marketingVersion, shortVersion }`, with
 * `undefined` for a setting the target does not declare.
 */
export function readTargets(yaml) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^targets:\s*$/.test(line));
  if (start === -1) throw new KyberError('project.yml has no top-level "targets:" block.');

  const targets = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== "") break; // back to a top-level key
    const header = /^ {2}([A-Za-z][\w.-]*):\s*$/.exec(line);
    if (header !== null) {
      current = header[1];
      targets.set(current, { marketingVersion: undefined, shortVersion: undefined });
      continue;
    }
    if (current === null) continue;
    const marketing = MARKETING.exec(line);
    if (marketing !== null) targets.get(current).marketingVersion = marketing[1];
    const short = SHORT_VERSION.exec(line);
    if (short !== null) targets.get(current).shortVersion = short[1];
  }
  if (targets.size === 0) throw new KyberError('project.yml declares no targets under "targets:".');
  return targets;
}

/**
 * Everything that must hold before a single byte is written.
 *
 * Returns the list of problems, empty when the file is in the expected shape.
 * Each one names the target, because "expected 3, found 2" sends you counting
 * instead of looking.
 */
export function versionProblems(targets, expected) {
  const problems = [];
  for (const name of expected) {
    const target = targets.get(name);
    if (target === undefined) {
      problems.push(`target "${name}" is in iosTargets but not in project.yml`);
      continue;
    }
    if (target.marketingVersion === undefined) {
      problems.push(`target "${name}" carries no MARKETING_VERSION`);
    }
    // The bug this catches was live on a phone: three MARKETING_VERSION values
    // agreeing, the guard green, and Settings showing an older number, because
    // one target spelled its CFBundleShortVersionString as a literal instead of
    // deriving it. The setting was measured and never the thing it feeds.
    if (target.shortVersion !== undefined && target.shortVersion !== "$(MARKETING_VERSION)") {
      problems.push(
        `target "${name}" sets CFBundleShortVersionString to ${target.shortVersion} ` +
          "instead of $(MARKETING_VERSION), so the number on screen is not the one moved here",
      );
    }
  }
  // The half a count cannot see: something outside the list carrying a version.
  for (const [name, target] of targets) {
    if (!expected.includes(name) && target.marketingVersion !== undefined) {
      problems.push(
        `target "${name}" carries MARKETING_VERSION but is not in iosTargets — ` +
          "add it there, or take the setting out of the target",
      );
    }
  }
  return problems;
}

/** Rewrite MARKETING_VERSION, but only inside the targets that were named. */
export function writeVersion(yaml, expected, version) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^targets:\s*$/.test(line));
  let current = null;
  let changed = 0;
  const out = lines.map((line, i) => {
    if (i <= start) return line;
    if (/^\S/.test(line) && line.trim() !== "") current = null;
    const header = /^ {2}([A-Za-z][\w.-]*):\s*$/.exec(line);
    if (header !== null) current = header[1];
    if (current !== null && expected.includes(current) && MARKETING.test(line)) {
      changed += 1;
      return line.replace(/MARKETING_VERSION:\s*"?[^"\n]*"?/, `MARKETING_VERSION: "${version}"`);
    }
    return line;
  });
  return { yaml: out.join("\n"), changed };
}
