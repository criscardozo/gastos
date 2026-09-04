#!/usr/bin/env node
// Run the rules tests on a port that is actually free.
//
// The suite used to hardcode 8080 through firebase.json, so it died with "port
// taken" whenever anything else held it — which on this machine is often: a
// Docker stack lives there, and a leftover emulator from an earlier session
// does too. The failure looked like a broken test run rather than a busy port,
// and the fix was to go hunting for whatever to kill. Twice.
//
// So: find a free port, write a config that uses it, and tell both the
// emulator and @firebase/rules-unit-testing (through FIRESTORE_EMULATOR_HOST)
// where to look. Override with FIRESTORE_EMULATOR_PORT to pin it.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const firebaseDir = resolve(here, "..");

/** Ask the OS for a free port by binding one and letting go. */
function freePort() {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });
}

async function usablePort(preferred) {
  if (preferred === undefined) return freePort();
  const port = Number(preferred);
  // A pinned port is a request, not a suggestion: if it is taken, say which
  // one and stop, rather than silently running somewhere else.
  const taken = await new Promise((ok) => {
    const server = createServer();
    server.once("error", () => ok(true));
    server.listen(port, "127.0.0.1", () => server.close(() => ok(false)));
  });
  if (taken) {
    console.error(`FIRESTORE_EMULATOR_PORT=${port} is already in use.`);
    process.exit(1);
  }
  return port;
}

const port = await usablePort(process.env.FIRESTORE_EMULATOR_PORT);

// A copy of firebase.json with the port replaced. The real one keeps 8080,
// which is what `pnpm emulators` and the iOS app expect.
const config = JSON.parse(readFileSync(join(firebaseDir, "firebase.json"), "utf8"));
config.emulators.firestore.port = port;
config.emulators.ui = { ...config.emulators.ui, enabled: false };
// Rules and indexes are relative to the config file, so the copy has to point
// back at the real directory.
config.firestore = {
  rules: join(firebaseDir, "firestore.rules"),
  indexes: join(firebaseDir, "firestore.indexes.json"),
};
const dir = mkdtempSync(join(tmpdir(), "gd-rules-"));
const configPath = join(dir, "firebase.json");
writeFileSync(configPath, JSON.stringify(config, null, 2));

if (port !== 8080) console.log(`firestore emulator on :${port} (8080 was busy)`);

const child = spawn(
  join(here, "node_modules", ".bin", "firebase"),
  [
    "emulators:exec",
    "--only", "firestore",
    "--project", "demo-gastos-diarios",
    "--config", configPath,
    "vitest run",
  ],
  {
    cwd: here,
    stdio: "inherit",
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}` },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
