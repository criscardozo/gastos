// The consumer's own Firestore emulator, as firebase.json declares it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KyberError } from "./errors.mjs";

/** The parsed firebase.json, which must declare a Firestore emulator port. */
export function readFirebaseJson(firebaseDir) {
  const path = join(firebaseDir, "firebase.json");
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new KyberError(`Cannot read ${path}: ${error.message}`);
  }
  const port = config?.emulators?.firestore?.port;
  if (!Number.isInteger(port)) {
    throw new KyberError(
      `${path} has no "emulators.firestore.port".\n` +
        "  kyber's scripts take the project's own emulator port from there, so\n" +
        "  that they never fall back to Firebase's default and talk to whatever\n" +
        "  happens to be listening on it. Add the block and pick a port.",
    );
  }
  return { path, config, port };
}

/** `host:port` of the consumer's emulator, from firebase.json. */
export function emulatorHost(firebaseDir) {
  return `127.0.0.1:${readFirebaseJson(firebaseDir).port}`;
}

/** Does this `host:port` name this machine? */
export function isLocal(hostPort) {
  const bare = hostPort.replace(/^https?:\/\//, "").replace(/^\[([^\]]+)\].*$/, "$1");
  const host = bare.startsWith("::") ? bare : bare.split(":")[0];
  return ["localhost", "127.0.0.1", "::1"].includes(host);
}
