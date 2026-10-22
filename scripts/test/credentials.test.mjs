import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { credentialsPath, loadServiceAccount } from "../lib/credentials.mjs";
import { KyberError } from "../lib/errors.mjs";

const withEnv = (value, fn) => {
  const before = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (value === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  else process.env.GOOGLE_APPLICATION_CREDENTIALS = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = before;
  }
};

test("credentialsPath prefers the env var, then the gitignored default, then fails", () => {
  const firebaseDir = mkdtempSync(join(tmpdir(), "kyber-creds-"));
  withEnv("/explicit/key.json", () => assert.equal(credentialsPath(firebaseDir), "/explicit/key.json"));
  withEnv(undefined, () => assert.throws(() => credentialsPath(firebaseDir), KyberError));
  writeFileSync(join(firebaseDir, "service-account.json"), "{}");
  withEnv(undefined, () => assert.equal(credentialsPath(firebaseDir), join(firebaseDir, "service-account.json")));
});

test("loadServiceAccount refuses a key for another project", () => {
  const firebaseDir = mkdtempSync(join(tmpdir(), "kyber-creds-"));
  writeFileSync(join(firebaseDir, "service-account.json"), JSON.stringify({ project_id: "other" }));
  withEnv(undefined, () => {
    assert.throws(() => loadServiceAccount(firebaseDir, "mine"), /belongs to "other", not "mine"/);
    assert.equal(loadServiceAccount(firebaseDir, "other").project_id, "other");
  });
});
