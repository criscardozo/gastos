// Where is the consumer, and what does it say about itself?
//
// kyber is a git submodule at `<consumer>/kyber/`, so the scripts in here run
// one directory deeper than the copies they replaced. The old
// `resolve(dirname(fileURLToPath(import.meta.url)), "..")` would now point at
// kyber itself and keep going — writing backups into the submodule, reading a
// firebase.json that does not exist — without ever failing. `git rev-parse
// --show-toplevel` is no better: inside a submodule it answers with the
// submodule's root.
//
// So the consumer root is found by walking UP until a `scripts/project.json`
// appears, and by failing out loud when none does.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { KyberError } from "./errors.mjs";

export const CONFIG_PATH = join("scripts", "project.json");

/**
 * The nearest ancestor of `from` (inclusive) holding `scripts/project.json`.
 *
 * Defaults to this file's own directory, which sits inside the consumer's
 * checkout whenever kyber is consumed as a submodule. Run from a bare kyber
 * clone there is no consumer above, and the error says where it looked.
 */
export function consumerRoot(from = import.meta.dirname) {
  const start = resolve(from);
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, CONFIG_PATH))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new KyberError(
    `No consumer found: looked for ${CONFIG_PATH} in ${start} and every ` +
      `directory above it.\n` +
      `  kyber scripts run inside a consumer that has a scripts/project.json at ` +
      `its root (see kyber/docs/consumer-config.md).`,
  );
}

/**
 * The consumer's config, checked for the keys THIS caller reads.
 *
 * Only `required` keys are validated, and unknown keys are ignored, so a
 * consumer can carry settings for a later batch of scripts without kyber
 * having to know them yet. Each required key must be a non-empty string.
 *
 * Returns `{ root, config, path }`; `dir(key)` resolves a directory-valued key
 * against the consumer root.
 */
export function loadConsumer({ required = [], from } = {}) {
  const root = consumerRoot(from);
  const path = join(root, CONFIG_PATH);
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new KyberError(`${path} is not valid JSON: ${error.message}`);
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new KyberError(`${path} must hold a JSON object.`);
  }
  const missing = required.filter(
    (key) => typeof config[key] !== "string" || config[key].trim() === "",
  );
  if (missing.length > 0) {
    throw new KyberError(
      `${path} is missing ${missing.map((k) => `"${k}"`).join(", ")}.\n` +
        `  Each must be a non-empty string (see kyber/docs/consumer-config.md).`,
    );
  }
  const dir = (key) => {
    if (typeof config[key] !== "string") {
      throw new KyberError(`${path}: "${key}" is not set.`);
    }
    return resolve(root, config[key]);
  };
  return { root, config, path, dir };
}
