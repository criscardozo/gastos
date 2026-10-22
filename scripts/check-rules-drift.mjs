#!/usr/bin/env node
// Is the rules file in the consumer's repo the one Firestore is actually
// enforcing?
//
// Rules are deployed by hand (`firebase deploy --only firestore:rules`) and
// nothing checked that the deployed copy matched the main branch. That gap is
// quiet in exactly the wrong way: the rules are the ONLY security boundary in
// these projects — there is no backend — so a fix that was written, reviewed,
// merged and never deployed reads as done in every place anyone would look.
//
// Runs weekly beside the backup, in the private backups repo, on the same
// service account and the same runner, so it costs no extra minutes worth
// counting.
//
// Usage: GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/check-rules-drift.mjs
// Reads from scripts/project.json: projectId, firebaseDir.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadFirebaseAdmin } from "./lib/admin.mjs";
import { loadConsumer } from "./lib/consumer.mjs";
import { loadServiceAccount } from "./lib/credentials.mjs";
import { run } from "./lib/errors.mjs";

/**
 * An access token for the Rules API.
 *
 * firebase-admin has no client for firebaserules.googleapis.com, so this asks
 * the credential it already holds for a token and calls the REST API directly,
 * rather than adding googleapis to the dependency tree for two GETs.
 */
async function accessToken(app) {
  const { access_token: token } = await app.options.credential.getAccessToken();
  return token;
}

async function get(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// Trailing whitespace only: anything else is a real difference.
const normalise = (text) => text.replace(/[ \t]+$/gm, "").replace(/\r\n/g, "\n").trimEnd();

async function main() {
  const { root, config, dir } = loadConsumer({ required: ["projectId", "firebaseDir"] });
  const firebaseDir = dir("firebaseDir");
  const localPath = join(firebaseDir, "firestore.rules");
  const projectId = config.projectId;

  const serviceAccount = loadServiceAccount(firebaseDir, projectId);
  const { cert, initializeApp } = await loadFirebaseAdmin();
  const app = initializeApp({ credential: cert(serviceAccount), projectId });
  const token = await accessToken(app);
  const base = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;

  // The release names the ruleset currently serving cloud.firestore; the
  // ruleset carries the source. Two hops, no way to shortcut them.
  const release = await get(`${base}/releases/cloud.firestore`, token);
  const ruleset = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, token);
  const deployed = normalise(ruleset.source.files.map((f) => f.content).join("\n"));
  const local = normalise(readFileSync(localPath, "utf8"));
  const rulesetId = release.rulesetName.split("/").pop();

  if (deployed === local) {
    console.log(
      `firestore.rules matches what ${projectId} is enforcing ` +
        `(ruleset ${rulesetId}, released ${release.updateTime}).`,
    );
    return;
  }

  const deployedLines = deployed.split("\n");
  const localLines = local.split("\n");
  console.error(
    `\nfirestore.rules does NOT match what ${projectId} is enforcing.\n` +
      `  deployed ruleset: ${rulesetId}\n` +
      `  released:         ${release.updateTime}\n` +
      `  deployed lines:   ${deployedLines.length}\n` +
      `  repo lines:       ${localLines.length}\n\n` +
      `  Deploy with:\n` +
      `    firebase deploy --only firestore:rules ` +
      `--config ${relative(root, join(firebaseDir, "firebase.json"))} --project ${projectId}\n`,
  );
  // The first differing line, which is usually enough to recognise which
  // change never went out.
  const upto = Math.max(deployedLines.length, localLines.length);
  for (let i = 0; i < upto; i += 1) {
    if (deployedLines[i] !== localLines[i]) {
      console.error(`  first difference at line ${i + 1}:`);
      console.error(`    deployed: ${deployedLines[i] ?? "(end of file)"}`);
      console.error(`    repo:     ${localLines[i] ?? "(end of file)"}`);
      break;
    }
  }
  process.exit(1);
}

run(main, {
  usage: "Usage: node scripts/check-rules-drift.mjs\n  Takes no arguments.",
});
