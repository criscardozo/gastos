import { defineConfig, devices } from "@playwright/test";

// E2E tests run ONLY against the Firebase emulators (never production).
//
// REQUIRED, started externally before `pnpm test:e2e`:
//   Auth emulator on :9099 and Firestore emulator on :8080 with project
//   "demo-gastos-diarios", e.g. from the repo root:
//     cd firebase/rules-tests && ./node_modules/.bin/firebase emulators:start \
//       --only auth,firestore --config ../firebase.json --project demo-gastos-diarios
//
// The Next.js dev server is started automatically (webServer below) with the
// emulator env vars, so sign-in uses the window.__devSignIn emulator-only
// hook (signInWithPopup cannot be automated headlessly).
// The dev-server port is configurable (E2E_PORT) so the suite can run while a
// separate dev server holds the default 3000.
const PORT = process.env.E2E_PORT ?? "3000";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
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
      // ports the suite is on (defaults 9099/8080 when unset).
      NEXT_PUBLIC_AUTH_EMULATOR_PORT:
        process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? "9099",
      NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT:
        process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? "8080",
    },
  },
});
