#!/usr/bin/env node
// Local Firestore backup: dumps the whole project (every root collection, with
// subcollections) to a timestamped JSON file. Firestore has no free managed
// export (that needs Blaze), so this is the $0 path: read everything with the
// Admin SDK and write it to disk.
//
// Usage, from the repo root:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json pnpm backup
//     (or drop the key at <firebaseDir>/service-account.json, gitignored)
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> pnpm backup
//     reads the emulator instead, for rehearsing the round trip
//
// Output: <repo>/backups/<name>-<source>-<stamp>.json (gitignored). The
// name carries where the data came from because a rehearsal against the
// emulator and a real backup are otherwise the same object, and the day you
// need one is the day you cannot check.
//
// Reads from scripts/project.json: name, projectId, emulatorProjectId, firebaseDir.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFirebaseAdmin } from "./lib/admin.mjs";
import { loadProject } from "./lib/project.mjs";
import { loadServiceAccount } from "./lib/credentials.mjs";
import { DUMP_FORMAT, createCodec, dumpFileName } from "./lib/dump.mjs";
import { run } from "./lib/errors.mjs";

// Recursively serialise a document's data plus every subcollection.
async function dumpDoc(serialize, db, snap) {
  const out = { id: snap.id };
  if (snap.exists) {
    out.data = serialize(snap.data(), snap.ref.path);
  } else {
    out.missing = true;
  }
  const subcollections = await snap.ref.listCollections();
  if (subcollections.length > 0) {
    out.collections = {};
    for (const sub of subcollections) {
      out.collections[sub.id] = await dumpCollection(serialize, db, sub);
    }
  }
  return out;
}

// `listDocuments()`, not `get()`: a query returns only documents that exist,
// so a deleted parent whose subcollections are still there — an italic id in
// the console — took everything under it out of the dump without a word. The
// listing includes those, and `getAll` says which ones have no document. Each
// document's data is also fetched once now; the query's snapshot used to be
// thrown away and every document fetched again.
//
// Sorted by id so a week's dump diffs against the last one by content, not by
// whatever order the listing came back in.
async function dumpCollection(serialize, db, collRef) {
  const refs = (await collRef.listDocuments()).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const docs = [];
  for (let i = 0; i < refs.length; i += 100) {
    for (const snap of await db.getAll(...refs.slice(i, i + 100))) {
      docs.push(await dumpDoc(serialize, db, snap));
    }
  }
  return docs;
}

async function main() {
  const { root, config, dir } = loadProject({
    required: ["name", "projectId", "emulatorProjectId", "firebaseDir"],
  });
  const { cert, initializeApp, getFirestore, Timestamp } = await loadFirebaseAdmin();
  const { serialize } = createCodec({ Timestamp });

  // `source` and `project` describe the connection that was actually opened,
  // never an argument. `BACKUP_PROJECT_ID` once overrode the label but not the
  // connection, so running with production credentials and that variable set
  // read the real data and stamped it as something else — a good backup that
  // restore refuses, because it checks the label. The label cannot come from
  // the same variable you might have got wrong.
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  let source;
  let project;
  if (emulator !== undefined && emulator !== "") {
    source = "emulator";
    project = process.env.BACKUP_PROJECT_ID ?? config.emulatorProjectId;
    console.log(`reading the EMULATOR at ${emulator} (project "${project}")`);
    initializeApp({ projectId: project });
  } else {
    const serviceAccount = loadServiceAccount(dir("firebaseDir"), config.projectId);
    source = "production";
    project = serviceAccount.project_id;
    console.log(`reading PRODUCTION (project "${project}")`);
    initializeApp({ credential: cert(serviceAccount), projectId: project });
  }
  const db = getFirestore();

  const dump = {
    format: DUMP_FORMAT,
    name: config.name,
    project,
    source,
    exportedAt: new Date().toISOString(),
    collections: {},
  };
  for (const coll of await db.listCollections()) {
    process.stdout.write(`  dumping ${coll.id}...`);
    dump.collections[coll.id] = await dumpCollection(serialize, db, coll);
    process.stdout.write(` ${dump.collections[coll.id].length} docs\n`);
  }

  const backups = join(root, "backups");
  mkdirSync(backups, { recursive: true });
  const file = join(backups, dumpFileName(config.name, source));
  writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`\nBackup written to ${file}`);
}

run(main, {
  usage:
    "Usage: GOOGLE_APPLICATION_CREDENTIALS=<key.json> node scripts/backup.mjs\n" +
    "  Dumps every root collection to backups/<name>-<source>-<stamp>.json.\n" +
    "  Set FIRESTORE_EMULATOR_HOST to read the emulator instead of production.",
});
