// firebase-admin, loaded from the repo's own node_modules.
//
// The root package.json declares it. When it is not installed, the raw
// failure is a module-resolution stack trace pointing into scripts/; this
// turns it into a sentence saying what to install.

import { ScriptError } from "./errors.mjs";

export async function loadFirebaseAdmin(importer = (specifier) => import(specifier)) {
  try {
    const [app, firestore] = await Promise.all([
      importer("firebase-admin/app"),
      importer("firebase-admin/firestore"),
    ]);
    return {
      cert: app.cert,
      initializeApp: app.initializeApp,
      getFirestore: firestore.getFirestore,
      Timestamp: firestore.Timestamp,
    };
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new ScriptError(
        "firebase-admin is not installed where the scripts can see it.\n" +
          "  The root package.json declares it; run `pnpm install` first.",
      );
    }
    throw error;
  }
}
