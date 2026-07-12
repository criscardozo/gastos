"use client";

// Firebase singletons — browser only. Everything is lazily initialized on
// first use from a client component; during prerender this module returns
// null and the UI stays in its loading shell.

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

import { firebaseConfig, useEmulators } from "./config";

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  googleProvider: GoogleAuthProvider;
}

let client: FirebaseClient | null = null;

export function getFirebaseClient(): FirebaseClient | null {
  if (typeof window === "undefined") return null;
  if (client !== null) return client;

  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });

  if (useEmulators) {
    connectAuthEmulator(auth, "http://localhost:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "localhost", 8080);

    // QA hook, emulator-only: signInWithPopup cannot be automated in a
    // headless browser, and the Auth emulator accepts any fabricated Google
    // credential. Never bundled in production (useEmulators is build-time).
    (
      window as unknown as {
        __devSignIn?: (name?: string, email?: string) => Promise<unknown>;
      }
    ).__devSignIn = (name = "Cristian Test", email = "cristian@test.dev") =>
      signInWithCredential(
        auth,
        GoogleAuthProvider.credential(
          JSON.stringify({
            sub: email.replace(/[^a-z0-9]/gi, ""),
            email,
            email_verified: true,
            name,
          }),
        ),
      );
  }

  client = { app, auth, db, googleProvider: new GoogleAuthProvider() };
  return client;
}
