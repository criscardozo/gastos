// Executables of packages the CONSUMER installed, found from where the consumer
// installed them.
//
// kyber has no node_modules of its own. `firebase` and `vitest` resolve today
// because both consumers declare them; a script that shells out to a bare name
// works only while pnpm has put a `.bin` on the PATH, and nothing says which
// one. Resolving through the package's own manifest gives the same binary
// however the script was started.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { KyberError } from "./errors.mjs";

/**
 * Absolute path of `binName` as declared by `packageName`'s `bin` field,
 * resolved as if required from `fromDir`.
 */
export function resolveBin(fromDir, packageName, binName) {
  const require = createRequire(join(fromDir, "package.json"));
  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new KyberError(
      `Cannot find "${packageName}" from ${fromDir}.\n` +
        `  kyber does not install it; the consumer must declare it ` +
        `(see peerDependencies in kyber/package.json).`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bin =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (typeof bin !== "string") {
    throw new KyberError(`"${packageName}" declares no "${binName}" executable.`);
  }
  return join(dirname(manifestPath), bin);
}

/**
 * Import a module the CONSUMER installed, resolved from `fromDir`.
 *
 * Same reason as resolveBin: kyber has no node_modules, so a bare specifier
 * would resolve by accident of where the process started, or not at all.
 */
export async function importFrom(fromDir, specifier) {
  const require = createRequire(join(fromDir, "package.json"));
  let resolved;
  try {
    resolved = require.resolve(specifier);
  } catch {
    throw new KyberError(
      `Cannot find "${specifier}" from ${fromDir}.\n` +
        "  kyber does not install it; the consumer's own workspace must declare it.",
    );
  }
  const namespace = await import(pathToFileURL(resolved).href);
  // A CommonJS package reached through dynamic import puts everything on
  // `default`. Node hoists named exports only when it can detect them
  // statically, which it cannot for many CJS builds — so `mod.chromium` comes
  // back undefined and the caller crashes one line later, on a package that is
  // installed and fine. Measured on a real one: the namespace held nothing but
  // `default` and `module.exports`, and every export was inside `default`.
  //
  // That shape is recognised exactly, rather than always preferring `default`:
  // an ESM module with a default export would otherwise have its named exports
  // shadowed by whatever the default happens to hold.
  const named = Object.keys(namespace).filter((k) => k !== "default" && k !== "module.exports");
  const inner = namespace.default;
  const carriesExports =
    inner !== null && (typeof inner === "object" || typeof inner === "function");
  if (named.length === 0 && carriesExports) return inner;
  return namespace;
}
