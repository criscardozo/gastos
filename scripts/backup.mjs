#!/usr/bin/env node
// Local Firestore backup — dumps the whole project (households + subcollections,
// users, invites) to a timestamped JSON file. Firestore has no free managed
// export (that needs Blaze), so this is the $0 path: read everything with the
// Admin SDK and write it to disk.
//
// Usage:
//   1. Firebase console -> Project settings -> Service accounts ->
//      "Generate new private key". Save it OUTSIDE the repo (or as
//      firebase/service-account.json, which is gitignored).
//   2. GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json pnpm backup
//      (or drop it at firebase/service-account.json and just `pnpm backup`)
//
// Output: backups/gastos-<YYYY-MM-DDTHH-MM-SSZ>.json (gitignored).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Keep the `-diarios`. The Firebase project id is permanent and still carries
// the old name: renaming the app to Gastos renamed the display name, the repo,
// the bundle ids and the Vercel project, and could not rename this. The
// rebranding pass shortened it here and in restore.mjs anyway, and the weekly
// backup failed with a permission error naming a project that does not exist.
//
// Guarded by apps/web/src/lib/project-id.test.ts, which greps for the wrong
// spelling — so this comment cannot write it out, even to warn about it. That
// is the right way round: a guard with a per-line exception is a guard that
// stops meaning anything, and the first one reaching for the exception was me.
const PROJECT_ID = "qcris-gastos-diarios";

function resolveCredentials() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const fallback = join(repoRoot, "firebase", "service-account.json");
  const path = explicit ?? (existsSync(fallback) ? fallback : null);
  if (path === null) {
    console.error(
      "No service account key found.\n" +
        "  Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json, or place the\n" +
        "  key at firebase/service-account.json (gitignored).\n" +
        "  Get one: Firebase console -> Project settings -> Service accounts.",
    );
    process.exit(1);
  }
  return path;
}

// Recursively serialize a document's data + every subcollection.
async function dumpDoc(docRef) {
  const snap = await docRef.get();
  const out = { id: docRef.id, data: serialize(snap.data() ?? {}) };
  const subcollections = await docRef.listCollections();
  if (subcollections.length > 0) {
    out.collections = {};
    for (const sub of subcollections) {
      out.collections[sub.id] = await dumpCollection(sub);
    }
  }
  return out;
}

async function dumpCollection(collRef) {
  const snap = await collRef.get();
  const docs = [];
  for (const doc of snap.docs) {
    docs.push(await dumpDoc(doc.ref));
  }
  return docs;
}

// Firestore types -> JSON-safe values (Timestamps become ISO strings).
function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serialize(v)]),
    );
  }
  return value;
}

async function main() {
  // Pointed at the emulator when FIRESTORE_EMULATOR_HOST is set, which is how
  // the restore is proven: seed, back up, wipe, restore, compare. A backup
  // nobody has ever read back is a hope, and the round trip cannot be
  // rehearsed against production.
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.BACKUP_PROJECT_ID ?? PROJECT_ID;
  const isEmulator = emulator !== undefined && emulator !== "";
  if (isEmulator) {
    console.log(`reading the EMULATOR at ${emulator} (project "${project}")`);
    initializeApp({ projectId: project });
  } else {
    const keyPath = resolveCredentials();
    const serviceAccount = JSON.parse(
      await import("node:fs").then((fs) => fs.readFileSync(keyPath, "utf8")),
    );
    initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
  }
  const db = getFirestore();

  const rootCollections = await db.listCollections();
  const dump = {
    project,
    // WHERE it was read from, which `project` cannot say.
    //
    // The emulator is started under the production project id on purpose (see
    // docs/reglas.md: under any other id the rules resolve isMember()'s get()
    // in an empty namespace and every subcollection reads back empty). The
    // consequence is that a rehearsal dump declares `qcris-gastos-diarios` and
    // is indistinguishable from the real thing — the check restore.mjs runs to
    // protect production passes on a file full of seed data. Two of those are
    // already in backups/, one with a household called "Casa" and a member
    // called "C".
    source: isEmulator ? "emulator" : "production",
    exportedAt: new Date().toISOString(),
    collections: {},
  };
  for (const coll of rootCollections) {
    process.stdout.write(`  dumping ${coll.id}...`);
    dump.collections[coll.id] = await dumpCollection(coll);
    process.stdout.write(` ${dump.collections[coll.id].length} docs\n`);
  }

  const dir = join(repoRoot, "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // The source goes in the NAME too. A directory listing is how somebody looks
  // for a backup on the day they need one, and until now the only way to tell
  // a rehearsal from the real ledger was to open the file and count documents.
  const file = join(dir, `gastos-${dump.source}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`\nBackup written to ${file}`);
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
