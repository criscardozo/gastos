// Where is the project root, and what does it say about itself?
//
// Found by walking UP until a `scripts/project.json` appears, and by failing
// out loud when none does. A fixed `..` from this file would be right today
// and silently wrong the day the file moves — which is what happened when
// these scripts lived in the kyber submodule, one level deeper, and a fixed
// `..` would have written backups into it without ever failing.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ScriptError } from "./errors.mjs";

export const CONFIG_PATH = join("scripts", "project.json");

/**
 * The nearest ancestor of `from` (inclusive) holding `scripts/project.json`.
 *
 * Defaults to this file's own directory, which sits inside the repo.
 */
export function projectRoot(from = import.meta.dirname) {
  const start = resolve(from);
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, CONFIG_PATH))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ScriptError(
    `No project found: looked for ${CONFIG_PATH} in ${start} and every ` +
      `directory above it.\n` +
      `  The scripts run inside a repo with a scripts/project.json ` +
      `(see scripts/README.md).`,
  );
}

/**
 * The project's config, checked for the keys THIS caller reads.
 *
 * Only `required` keys are validated, and unknown keys are ignored, so the
 * file can carry settings no script reads yet. Each required key must be a
 * non-empty string.
 *
 * Returns `{ root, config, path }`; `dir(key)` resolves a directory-valued key
 * against the project root.
 */
export function loadProject({ required = [], from } = {}) {
  const root = projectRoot(from);
  const path = join(root, CONFIG_PATH);
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ScriptError(`${path} is not valid JSON: ${error.message}`);
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new ScriptError(`${path} must hold a JSON object.`);
  }
  const missing = required.filter(
    (key) => typeof config[key] !== "string" || config[key].trim() === "",
  );
  if (missing.length > 0) {
    throw new ScriptError(
      `${path} is missing ${missing.map((k) => `"${k}"`).join(", ")}.\n` +
        `  Each must be a non-empty string (see scripts/README.md).`,
    );
  }
  const dir = (key) => {
    if (typeof config[key] !== "string") {
      throw new ScriptError(`${path}: "${key}" is not set.`);
    }
    return resolve(root, config[key]);
  };
  return { root, config, path, dir };
}
