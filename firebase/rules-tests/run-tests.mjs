#!/usr/bin/env node
// Run the rules tests on a port that is actually free.
//
// The suite used to hardcode Firestore's port through firebase.json, so it died
// with "port
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

/** Is this port free right now? */
async function isFree(port) {
  return new Promise((ok) => {
    const server = createServer();
    server.once("error", () => ok(false));
    server.listen(port, "127.0.0.1", () => server.close(() => ok(true)));
  });
}

async function usablePort(preferred, pinned) {
  if (preferred === undefined) {
    // The project's own port first, an ephemeral one only if it is taken.
    //
    // It used to go straight to an ephemeral port and then print "(8080 was
    // busy)" — which it had never tried. A message that names a port it did
    // not attempt sends you to look at the wrong thing.
    return (await isFree(pinned)) ? pinned : freePort();
  }
  const port = Number(preferred);
  // A pinned port is a request, not a suggestion: if it is taken, say which
  // one and stop, rather than silently running somewhere else.
  if (!(await isFree(port))) {
    console.error(`FIRESTORE_EMULATOR_PORT=${port} is already in use.`);
    process.exit(1);
  }
  return port;
}

// A copy of firebase.json with the ports replaced. The real one keeps the
// project's own block, which is what `pnpm emulators` and the iOS app expect.
const config = JSON.parse(readFileSync(join(firebaseDir, "firebase.json"), "utf8"));
const pinned = config.emulators.firestore.port;
const port = await usablePort(process.env.FIRESTORE_EMULATOR_PORT, pinned);
config.emulators.firestore.port = port;
// The websocket, the hub and the logging port get free ones too.
//
// They used to be absent from the config, so firebase-tools fell back to its
// defaults and shifted them itself when busy ("hub unable to start on port
// 4400, starting on 4401 instead"). Now that the project pins them, a test run
// alongside a running `pnpm emulators` would collide on the pinned numbers —
// and a pinned port does not shift. So this copy asks for free ones, the same
// as it already does for Firestore.
config.emulators.firestore.websocketPort = await freePort();
config.emulators.hub = { port: await freePort() };
config.emulators.logging = { port: await freePort() };
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

if (port !== pinned) console.log(`firestore emulator on :${port} (${pinned} was busy)`);

const child = spawn(
  join(here, "node_modules", ".bin", "firebase"),
  [
    "emulators:exec",
    "--only", "firestore",
    "--project", "demo-gastos",
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
