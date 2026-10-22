import assert from "node:assert/strict";
import { test } from "node:test";
import { loadFirebaseAdmin } from "../lib/admin.mjs";
import { ScriptError } from "../lib/errors.mjs";

test("a missing firebase-admin becomes a sentence naming what to install", async () => {
  const missing = async () => {
    throw Object.assign(new Error("Cannot find package"), { code: "ERR_MODULE_NOT_FOUND" });
  };
  await assert.rejects(
    loadFirebaseAdmin(missing),
    (error) => error instanceof ScriptError && error.message.includes("pnpm install"),
  );
});

test("any other import failure keeps its identity", async () => {
  const broken = async () => {
    throw Object.assign(new Error("syntax"), { code: "ERR_SOMETHING_ELSE" });
  };
  await assert.rejects(loadFirebaseAdmin(broken), /syntax/);
});

test("the four names the scripts use come back from the two subpaths", async () => {
  const fake = async (specifier) =>
    specifier.endsWith("/app")
      ? { cert: "cert", initializeApp: "init" }
      : { getFirestore: "db", Timestamp: "ts" };
  assert.deepEqual(await loadFirebaseAdmin(fake), {
    cert: "cert",
    initializeApp: "init",
    getFirestore: "db",
    Timestamp: "ts",
  });
});
