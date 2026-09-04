#!/usr/bin/env node
// Put a backup back.
//
// `pnpm backup` has been running weekly for months and had never been read
// back once, which makes it a hope rather than a backup: nobody knew whether
// the dump could be restored, and the day you find out is the worst possible
// day to find out.
//
// Usage:
//   pnpm restore backups/gastos-diarios-<stamp>.json
//     → restores into the local EMULATOR, which is the default on purpose.
//
//   pnpm restore --production backups/<file>.json
//     → restores into the real project. Refuses unless the dump's own
//       `project` field matches, and asks for a typed confirmation first.
//
// The emulator target needs the suite running with the app's project id:
//   firebase emulators:start --only auth,firestore \
//     --config firebase/firebase.json --project qcris-gastos-diarios
//
// (That id is not a detail — see docs/reglas.md. Started under a different one,
// the rules resolve their get() in a namespace where no household exists and
// every subcollection reads back empty.)

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = "qcris-gastos-diarios";

/**
 * ISO strings back into Timestamps.
 *
 * The dump flattens every Timestamp to an ISO string, which loses the type.
 * Guessing it back from the string alone would be wrong the first time somebody
 * writes a note that looks like a date, so this needs BOTH signals: the key
 * ends in `At` — the naming every timestamp field in shared/schema.md follows —
 * and the value is a strict ISO-8601 instant. A note called "createdAt" holding
 * "2026-09-04T00:00:00.000Z" would still fool it; nothing in this schema has
 * one, and the alternative is a hardcoded field list that goes stale silently.
 */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function deserialize(value, key = "") {
  if (typeof value === "string" && key.endsWith("At") && ISO.test(value)) {
    return Timestamp.fromDate(new Date(value));
  }
  if (Array.isArray(value)) return value.map((v) => deserialize(v, key));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, deserialize(v, k)]),
    );
  }
  return value;
}

function resolveCredentials() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const fallback = join(repoRoot, "firebase", "service-account.json");
  const path = explicit ?? (existsSync(fallback) ? fallback : null);
  if (path === null) {
    console.error(
      "No service account key found.\n" +
        "  Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json, or place the\n" +
        "  key at firebase/service-account.json (gitignored).",
    );
    process.exit(1);
  }
  return path;
}

/** Write one document and everything under it. */
async function restoreDoc(db, collectionPath, doc, counts) {
  const ref = db.collection(collectionPath).doc(doc.id);
  await ref.set(deserialize(doc.data ?? {}));
  counts[collectionPath] = (counts[collectionPath] ?? 0) + 1;
  for (const [name, docs] of Object.entries(doc.collections ?? {})) {
    for (const child of docs) {
      await restoreDoc(db, `${collectionPath}/${doc.id}/${name}`, child, counts);
    }
  }
}

async function confirmProduction(file, project) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(
    `\nAbout to write ${file}\n  INTO THE REAL PROJECT: ${project}\n\n` +
      "  Every document in the dump is written over whatever is there now.\n" +
      "  Documents that exist today but are NOT in the dump are left alone —\n" +
      "  this restores, it does not wipe.\n",
  );
  const answer = await rl.question(`  Type the project id to continue: `);
  rl.close();
  if (answer.trim() !== project) {
    console.error("  Did not match. Nothing was written.");
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const production = args.includes("--production");
  const file = args.find((a) => !a.startsWith("--"));
  if (file === undefined) {
    console.error("Usage: pnpm restore [--production] <backup file>");
    process.exit(1);
  }

  const dump = JSON.parse(readFileSync(file, "utf8"));
  if (typeof dump.collections !== "object" || dump.collections === null) {
    console.error(`${file} is not a backup: no top-level "collections".`);
    process.exit(1);
  }

  const emulator = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  if (production) {
    // The dump names the project it came from. Restoring a dump of one project
    // into another is never a thing anyone means to do, so it is refused
    // rather than confirmed.
    if (dump.project !== PROJECT_ID) {
      console.error(
        `This dump is from "${dump.project}", not "${PROJECT_ID}". Refusing.`,
      );
      process.exit(1);
    }
    await confirmProduction(file, PROJECT_ID);
    const serviceAccount = JSON.parse(readFileSync(resolveCredentials(), "utf8"));
    initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
    console.log(`\nrestoring into PRODUCTION (${PROJECT_ID})`);
  } else {
    // Same guard the seed uses, for the same reason: what makes it safe to
    // write a fixture into a database named after production is that the host
    // is local. So the host is what gets checked, and it is said out loud.
    const bare = emulator.replace(/^https?:\/\//, "").split(":")[0];
    if (!["localhost", "127.0.0.1", "::1"].includes(bare)) {
      console.error(
        `FIRESTORE_EMULATOR_HOST is "${emulator}", which is not local. Refusing.`,
      );
      process.exit(1);
    }
    process.env.FIRESTORE_EMULATOR_HOST = emulator;
    initializeApp({ projectId: dump.project ?? PROJECT_ID });
    console.log(
      `restoring into the EMULATOR at ${emulator} ` +
        `(project "${dump.project ?? PROJECT_ID}")`,
    );
  }

  const db = getFirestore();
  const counts = {};
  for (const [name, docs] of Object.entries(dump.collections)) {
    for (const doc of docs) await restoreDoc(db, name, doc, counts);
  }

  console.log(`\nrestored from ${file} (exported ${dump.exportedAt}):`);
  for (const [path, n] of Object.entries(counts).sort()) {
    console.log(`  ${n.toString().padStart(5)}  ${path}`);
  }
}

main().catch((error) => {
  console.error("Restore failed:", error);
  process.exit(1);
});
