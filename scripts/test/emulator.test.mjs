import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { emulatorHost, isLocal, readFirebaseJson } from "../lib/emulator.mjs";
import { ScriptError } from "../lib/errors.mjs";
import { PROJECT, FIXTURES } from "./helpers.mjs";

test("readFirebaseJson returns the project's Firestore emulator port", () => {
  const { port } = readFirebaseJson(join(PROJECT, "firebase"));
  assert.equal(port, 8181);
  assert.equal(emulatorHost(join(PROJECT, "firebase")), "127.0.0.1:8181");
});

test("readFirebaseJson fails with a message when the Firestore block is missing", () => {
  assert.throws(
    () => readFirebaseJson(join(FIXTURES, "no-port", "firebase")),
    (error) => error instanceof ScriptError && error.message.includes("emulators.firestore.port"),
  );
});

test("readFirebaseJson fails with a message when firebase.json is absent", () => {
  assert.throws(() => readFirebaseJson(join(FIXTURES, "nope")), /Cannot read/);
});

test("isLocal accepts loopback names and refuses anything else", () => {
  for (const ok of ["127.0.0.1:8080", "localhost:8181", "http://localhost:1", "[::1]:8080", "::1"]) {
    assert.equal(isLocal(ok), true, ok);
  }
  for (const bad of ["10.0.0.5:8080", "emulator.internal:8080", "http://192.168.1.2:8080"]) {
    assert.equal(isLocal(bad), false, bad);
  }
});
