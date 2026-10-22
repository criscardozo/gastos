#!/usr/bin/env node
// Run the consumer's Firestore rules tests on a port that is actually free.
//
// `firebase emulators:exec` takes its port from firebase.json, so a busy port
// ends the run with "Could not start Firestore Emulator, port taken" — which
// reads exactly like a broken test suite and sends you looking at the rules.
// It happens whenever anything else holds the port: a Docker stack, a leftover
// emulator from an earlier session, the same project's own `pnpm emulators`
// started minutes earlier for something else.
//
// So: find a free port, write a copy of firebase.json that uses it, and tell
// both the emulator and @firebase/rules-unit-testing where to look. The
// consumer's `firebase.json` is never touched; it keeps the project's own
// block, which is what `pnpm emulators` and the iOS app expect.
//
// The tests learn the port through FIRESTORE_EMULATOR_HOST, which
// rules-unit-testing reads only when the test helper passes no host/port of
// its own — so the helper must not opine (see docs/consumer-config.md).
// FIRESTORE_EMULATOR_PORT is exported too, for a helper that reads that.
//
// Override with FIRESTORE_EMULATOR_PORT=<n> to pin a port: then it is a
// request, not a suggestion, and a busy port stops the run rather than
// silently running somewhere else.
//
// Reads from scripts/project.json: name, rulesTestsProjectId, firebaseDir,
// rulesTestsDir.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBin } from "./lib/bin.mjs";
import { loadConsumer } from "./lib/consumer.mjs";
import { readFirebaseJson } from "./lib/emulator.mjs";
import { KyberError, run } from "./lib/errors.mjs";

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
function isFree(port) {
  return new Promise((ok) => {
    const server = createServer();
    server.once("error", () => ok(false));
    server.listen(port, "127.0.0.1", () => server.close(() => ok(true)));
  });
}

async function usablePort(pinned, requested) {
  if (requested === undefined || requested === "") {
    // The project's own port first, an ephemeral one only if it is taken. A
    // message that names a port it never tried sends you to the wrong place,
    // so the project's port is genuinely attempted before being reported busy.
    return (await isFree(pinned)) ? pinned : freePort();
  }
  const port = Number(requested);
  // Above 65535 too: listen() throws on it synchronously, inside isFree's
  // promise, and the sentence below became a stack trace.
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new KyberError(`FIRESTORE_EMULATOR_PORT="${requested}" is not a port.`);
  }
  if (!(await isFree(port))) {
    throw new KyberError(`FIRESTORE_EMULATOR_PORT=${port} is already in use.`);
  }
  return port;
}

function shellQuote(path) {
  return `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}

async function main() {
  const { config, dir } = loadConsumer({
    required: ["name", "rulesTestsProjectId", "firebaseDir", "rulesTestsDir"],
  });
  const firebaseDir = dir("firebaseDir");
  const rulesTestsDir = dir("rulesTestsDir");
  if (!existsSync(join(rulesTestsDir, "package.json"))) {
    throw new KyberError(`rulesTestsDir ${rulesTestsDir} has no package.json.`);
  }
  const firebaseBin = resolveBin(rulesTestsDir, "firebase-tools", "firebase");
  const vitestBin = resolveBin(rulesTestsDir, "vitest", "vitest");

  const { config: firebaseJson, port: pinned } = readFirebaseJson(firebaseDir);
  const port = await usablePort(pinned, process.env.FIRESTORE_EMULATOR_PORT);

  // A copy of firebase.json with the ports replaced. The websocket, the hub
  // and the logging port get free ones too: a consumer that pins them (so its
  // development suite lands in its own block) would otherwise collide with a
  // running `pnpm emulators`, and a pinned port is one firebase-tools will
  // not shift on its own. Rules and indexes are relative to the config file,
  // so the copy points back at the real directory.
  const copy = structuredClone(firebaseJson);
  copy.emulators.firestore.port = port;
  copy.emulators.firestore.websocketPort = await freePort();
  copy.emulators.hub = { port: await freePort() };
  copy.emulators.logging = { port: await freePort() };
  copy.emulators.ui = { ...copy.emulators.ui, enabled: false };
  copy.firestore = { rules: join(firebaseDir, "firestore.rules") };
  const indexes = join(firebaseDir, "firestore.indexes.json");
  if (existsSync(indexes)) copy.firestore.indexes = indexes;

  const tmp = mkdtempSync(join(tmpdir(), `${config.name}-rules-`));
  const configPath = join(tmp, "firebase.json");
  writeFileSync(configPath, JSON.stringify(copy, null, 2));

  if (port !== pinned) console.log(`firestore emulator on :${port} (${pinned} was busy)`);

  const child = spawn(
    process.execPath,
    [
      firebaseBin,
      "emulators:exec",
      "--only", "firestore",
      "--project", config.rulesTestsProjectId,
      "--config", configPath,
      // The ONLY shell string in this repo: `emulators:exec` takes a command,
      // not argv, so this one is unavoidable. What goes into it comes from
      // resolution on disk and never from the consumer's config — a config
      // value reaching an interpreter is arbitrary code execution for whoever
      // checks out the branch that edited it. Everything else here spawns with
      // an argv array precisely so this stays the only line to think about.
      `${shellQuote(process.execPath)} ${shellQuote(vitestBin)} run`,
    ],
    {
      cwd: rulesTestsDir,
      stdio: "inherit",
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`,
        FIRESTORE_EMULATOR_PORT: String(port),
      },
    },
  );
  // A child that never started emits `error` and no `exit`. With no listener
  // that was an uncaught exception, and the temporary config stayed behind.
  child.on("error", (error) => {
    rmSync(tmp, { recursive: true, force: true });
    console.error(`Could not start the emulator: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    rmSync(tmp, { recursive: true, force: true });
    // The child's status, not this script's: a wrapper that swallows a
    // non-zero exit is green output over a red reality.
    process.exit(signal ? 1 : (code ?? 1));
  });
}

run(main, {
  usage: "Usage: node scripts/run-rules-tests.mjs\n  Takes no arguments.",
});
