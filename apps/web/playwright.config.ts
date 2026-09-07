import { defineConfig, devices } from "@playwright/test";

// E2E tests run ONLY against the Firebase emulators (never production).
//
// REQUIRED, started externally before `pnpm test:e2e`:
//   Auth emulator on :9390 and Firestore emulator on :8390 with project
//   "demo-gastos-diarios", e.g. from the repo root:
//     cd firebase/rules-tests && ./node_modules/.bin/firebase emulators:start \
//       --only auth,firestore --config ../firebase.json --project demo-gastos-diarios
//
// The Next.js dev server is started automatically (webServer below) with the
// emulator env vars, so sign-in uses the window.__devSignIn emulator-only
// hook (signInWithPopup cannot be automated headlessly).
// The dev server runs on 3390 — this project's own port block, like the
// emulators (see firebase/firebase.json), not Next's default 3000. On this
// machine 3000 is held by a neighbouring project's `next dev` most of the day,
// and the failure is `EADDRINUSE` from Playwright's webServer, which reads as
// the suite being broken. Nothing registers this port (e2e signs in through
// the emulator hook, so there is no OAuth redirect URI to whitelist), which is
// what makes it free to move — unlike `pnpm dev`, still on 3000 because
// `localhost:3000` is an authorized domain in the Firebase console.
// Override with E2E_PORT.
const PORT = process.env.E2E_PORT ?? "3390";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  // The suite runs against `next dev`, which compiles each route the first time
  // it is opened. On a warm machine that is instant; on a cold CI runner the
  // first navigation to a route can take longer than the 5s default, which is
  // a slow toolchain rather than a broken app — so assertions wait longer
  // instead of the suite reporting a failure that never reproduces locally.
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    // Never reuse a server that might be running WITHOUT the emulator env.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_USE_EMULATORS: "1",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-gastos-diarios",
      // Pass the emulator ports through so the dev server connects to whatever
      // ports the suite is on (defaults 9390/8390 when unset).
      NEXT_PUBLIC_AUTH_EMULATOR_PORT:
        process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? "9390",
      NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT:
        process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? "8390",
    },
  },
});
