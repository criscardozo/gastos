// The service-account key, found and checked the same way in every script
// that talks to production. Three copies of this used to live in three files.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KyberError } from "./errors.mjs";

/** Path of the key: the explicit env var, or the gitignored default. */
export function credentialsPath(firebaseDir) {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicit !== undefined && explicit !== "") return explicit;
  const fallback = join(firebaseDir, "service-account.json");
  if (existsSync(fallback)) return fallback;
  throw new KyberError(
    "No service account key found.\n" +
      "  Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json, or place the\n" +
      `  key at ${fallback} (gitignored).\n` +
      "  Get one: Firebase console -> Project settings -> Service accounts.",
  );
}

/**
 * The parsed key, refused unless it belongs to `expectedProjectId`.
 *
 * The credential decides which project a script talks to, so the key's own
 * `project_id` is the only honest label — never a constant, and never an env
 * var, both of which are things somebody can have got wrong.
 */
export function loadServiceAccount(firebaseDir, expectedProjectId) {
  const path = credentialsPath(firebaseDir);
  let account;
  try {
    account = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new KyberError(`Cannot read the service account at ${path}: ${error.message}`);
  }
  if (account.project_id !== expectedProjectId) {
    throw new KyberError(
      `That key belongs to "${account.project_id}", not "${expectedProjectId}".\n` +
        "  Refusing rather than touching a project the config does not name.",
    );
  }
  return account;
}
