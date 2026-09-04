#!/usr/bin/env node
// Is the rules file in this repo the one Firestore is actually enforcing?
//
// Rules are deployed by hand (`firebase deploy --only firestore:rules`) and
// nothing checked that the deployed copy matched main. That gap is quiet in
// exactly the wrong way: the rules are the ONLY security boundary in this
// project — there is no backend — so a fix that was written, reviewed, merged
// and never deployed reads as done in every place anyone would look.
//
// Runs weekly beside the backup, on the same service account and the same
// runner, so it costs no extra minutes worth counting.
//
// Usage: GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/check-rules-drift.mjs

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ID = "qcris-gastos-diarios";
const LOCAL = join(repoRoot, "firebase", "firestore.rules");

function credentialsPath() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const fallback = join(repoRoot, "firebase", "service-account.json");
  const path = explicit ?? (existsSync(fallback) ? fallback : null);
  if (path === null) {
    console.error(
      "No service account key found. Set GOOGLE_APPLICATION_CREDENTIALS, or\n" +
        "place the key at firebase/service-account.json (gitignored).",
    );
    process.exit(1);
  }
  return path;
}

/**
 * An access token for the Rules API.
 *
 * firebase-admin has no client for firebaserules.googleapis.com, so this asks
 * the credential it already holds for a token and calls the REST API directly
 * — rather than adding googleapis to the dependency tree for two GETs.
 */
async function accessToken(app) {
  const credential = app.options.credential;
  const { access_token: token } = await credential.getAccessToken();
  return token;
}

async function get(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  const serviceAccount = JSON.parse(readFileSync(credentialsPath(), "utf8"));
  const app = initializeApp({
    credential: cert(serviceAccount),
    projectId: PROJECT_ID,
  });
  const token = await accessToken(app);
  const base = `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}`;

  // The release names the ruleset currently serving cloud.firestore; the
  // ruleset carries the source. Two hops, no way to shortcut them.
  const release = await get(`${base}/releases/cloud.firestore`, token);
  const ruleset = await get(
    `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
    token,
  );
  const deployed = ruleset.source.files.map((f) => f.content).join("\n");
  const local = readFileSync(LOCAL, "utf8");

  // Trailing whitespace only: anything else is a real difference.
  const normalise = (text) =>
    text.replace(/[ \t]+$/gm, "").replace(/\r\n/g, "\n").trimEnd();

  if (normalise(deployed) === normalise(local)) {
    console.log(
      `firestore.rules matches what ${PROJECT_ID} is enforcing ` +
        `(ruleset ${release.rulesetName.split("/").pop()}, ` +
        `released ${release.updateTime}).`,
    );
    return;
  }

  const deployedLines = normalise(deployed).split("\n");
  const localLines = normalise(local).split("\n");
  console.error(
    `\nfirestore.rules does NOT match what ${PROJECT_ID} is enforcing.\n` +
      `  deployed ruleset: ${release.rulesetName.split("/").pop()}\n` +
      `  released:         ${release.updateTime}\n` +
      `  deployed lines:   ${deployedLines.length}\n` +
      `  repo lines:       ${localLines.length}\n\n` +
      `  Deploy with:\n` +
      `    firebase deploy --only firestore:rules ` +
      `--config firebase/firebase.json --project ${PROJECT_ID}\n`,
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

main().catch((error) => {
  console.error("Rules drift check failed:", error.message);
  process.exit(1);
});
