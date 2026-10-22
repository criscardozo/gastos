// firebase-admin, loaded from wherever the CONSUMER installed it.
//
// kyber declares it as a peer and installs nothing, so the import resolves
// through Node's walk-up into the consumer's node_modules. When it is not
// there, the raw failure is a module-resolution stack trace pointing into
// kyber; this turns it into a sentence naming who has to install what.

import { KyberError } from "./errors.mjs";

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
      throw new KyberError(
        "firebase-admin is not installed where kyber can see it.\n" +
          "  kyber installs nothing; the consumer declares firebase-admin in its own\n" +
          "  package.json (see peerDependencies in kyber/package.json) and its\n" +
          "  node_modules must be above kyber/ in the tree. Run the install first.",
      );
    }
    throw error;
  }
}
