#!/usr/bin/env node
// Put a backup back. A backup nobody has ever read back is a hope, and the day
// you find out whether it restores is the worst possible day to find out.
//
// Usage, from the consumer:
//   pnpm restore backups/<file>.json
//     → into the local EMULATOR (the consumer's own port, from firebase.json,
//       unless FIRESTORE_EMULATOR_HOST says otherwise). The default on purpose.
//   pnpm restore --production backups/<file>.json
//     → into the real project. Refuses unless the dump names that project AND
//       was read from production, then asks for a typed confirmation.
//
// Every document in the dump is written over whatever is there; documents that
// exist today but are not in the dump are left alone. This restores, it does
// not wipe. A document the dump marks `missing` did not exist when it was
// taken: what was under it is restored, and it is not created.
//
// Reads from scripts/project.json: projectId, emulatorProjectId, firebaseDir,
// and optionally restore.legacyIsoTimestamps.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadFirebaseAdmin } from "./lib/admin.mjs";
import { loadConsumer } from "./lib/consumer.mjs";
import { loadServiceAccount } from "./lib/credentials.mjs";
import { createCodec } from "./lib/dump.mjs";
import { emulatorHost, isLocal } from "./lib/emulator.mjs";
import { KyberError, run } from "./lib/errors.mjs";

function readDump(file) {
  if (!existsSync(file)) throw new KyberError(`No such dump: ${file}`);
  let dump;
  try {
    dump = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new KyberError(`${file} is not JSON: ${error.message}`);
  }
  if (dump === null || typeof dump.collections !== "object" || dump.collections === null) {
    throw new KyberError(`${file} is not a backup: no top-level "collections".`);
  }
  return dump;
}

async function confirmProduction(file, dump, projectId) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(
    `\nAbout to write ${file} (exported ${dump.exportedAt})\n` +
      `  INTO THE REAL PROJECT: ${projectId}\n\n` +
      "  Every document in the dump is written over whatever is there now.\n" +
      "  Documents that exist today but are NOT in the dump are left alone.\n",
  );
  // A closed input is a no. Without this, input that ends before an answer
  // (Ctrl-D) left the question pending forever.
  const answer = await new Promise((settle, fail) => {
    rl.once("close", () => fail(new KyberError("  No answer. Nothing was written.")));
    rl.question("  Type the project id to continue: ", settle);
  });
  rl.close();
  if (answer.trim() !== projectId) {
    throw new KyberError("  Did not match. Nothing was written.");
  }
}

async function main() {
  const { config, dir } = loadConsumer({
    required: ["projectId", "emulatorProjectId", "firebaseDir"],
  });
  const args = process.argv.slice(2);
  const production = args.includes("--production");
  const arg = args.find((a) => !a.startsWith("--"));
  if (arg === undefined) {
    throw new KyberError("Usage: pnpm restore [--production] <backup file>");
  }
  const file = resolve(arg);
  const dump = readDump(file);
  const { cert, initializeApp, getFirestore, Timestamp } = await loadFirebaseAdmin();
  const { restorePlan } = createCodec({ Timestamp });
  // Decided before anything is opened: a dump this restore cannot read, down
  // to one bad value in one document, is refused with nothing written.
  const writes = restorePlan(dump, config);
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;

  if (production) {
    // The dump names the project it came from. Restoring one project's dump
    // into another is never a thing anyone means to do, so it is refused
    // rather than confirmed.
    if (dump.project !== config.projectId) {
      throw new KyberError(
        `This dump is from "${dump.project}", not "${config.projectId}". Refusing.`,
      );
    }
    // And WHERE it was read from, which the check above cannot see: a
    // consumer whose emulator runs under the production project id produces
    // rehearsal dumps that pass it while holding seed data. Restoring one
    // into production would not fail — it would succeed, and overwrite real
    // data with a fixture. A dump with no `source` predates the field and is
    // refused rather than assumed either way.
    if (dump.source !== "production") {
      throw new KyberError(
        dump.source === undefined
          ? 'This dump has no "source" field, so it cannot be told apart from a\n' +
            "  rehearsal. Open it, make sure it is real data, and add\n" +
            '  "source": "production" by hand — or take a fresh backup.'
          : `This dump was read from the ${dump.source}, not production. Refusing.`,
      );
    }
    if (emulator !== undefined && emulator !== "") {
      throw new KyberError(
        "FIRESTORE_EMULATOR_HOST is set and --production was passed. Pick one.",
      );
    }
    // The confirmation is a person typing the project id. With no terminal
    // there is no person, and the question used to sit there forever.
    if (!process.stdin.isTTY) {
      throw new KyberError(
        "--production asks for the project id typed, and stdin is not a terminal.\n" +
          "  Run it from an interactive shell. Nothing was written.",
      );
    }
    const serviceAccount = loadServiceAccount(dir("firebaseDir"), config.projectId);
    await confirmProduction(file, dump, config.projectId);
    initializeApp({ credential: cert(serviceAccount), projectId: config.projectId });
    console.log(`\nrestoring into PRODUCTION (${config.projectId})`);
  } else {
    // The consumer's own emulator port, never Firebase's default: on a machine
    // where something else holds 8080, a restore pointed there would talk to
    // somebody else's database. What makes it safe to write a fixture into a
    // database named after production is that the host is local, so the host
    // is what gets checked, and it is said out loud.
    const host = emulator !== undefined && emulator !== "" ? emulator : emulatorHost(dir("firebaseDir"));
    if (!isLocal(host)) {
      throw new KyberError(`FIRESTORE_EMULATOR_HOST is "${host}", which is not local. Refusing.`);
    }
    process.env.FIRESTORE_EMULATOR_HOST = host;
    const project = process.env.BACKUP_PROJECT_ID ?? config.emulatorProjectId;
    initializeApp({ projectId: project });
    console.log(`restoring into the EMULATOR at ${host} (project "${project}")`);
  }

  const db = getFirestore();
  const counts = {};
  let missing = 0;
  for (const { collection, id, data } of writes) {
    if (data === null) {
      missing += 1;
      continue;
    }
    await db.collection(collection).doc(id).set(data);
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  console.log(`\nrestored from ${file} (exported ${dump.exportedAt}):`);
  for (const [path, n] of Object.entries(counts).sort()) {
    console.log(`  ${n.toString().padStart(5)}  ${path}`);
  }
  if (missing > 0) {
    console.log(`  ${missing.toString().padStart(5)}  missing parents, not created (as in the dump)`);
  }
}

run(main, {
  usage:
    "Usage: node scripts/restore.mjs [--production] <backup file>\n" +
    "  Without --production it writes to the emulator.",
  flags: ["--production"],
  operands: 1,
});
