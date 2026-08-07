/**
 * PWA smoke check: proves the installed app can start with no network.
 *
 * The service worker is registered in PRODUCTION builds only, so this runs
 * against `next start` — not the dev server, and not the emulator-backed E2E
 * suite (which is why it lives outside playwright.config.ts). It signs nobody
 * in: it verifies the shell caches and boots offline, which is the part the
 * home-screen app depends on.
 *
 *   pnpm build && pnpm --filter web exec next start -p 3112 &
 *   pnpm verify:pwa
 */
import { chromium } from "@playwright/test";

const BASE = process.env.PWA_BASE_URL ?? "http://localhost:3112";

let failures = 0;
function check(label, pass, extra = "") {
  if (!pass) failures += 1;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`,
  );
}

const reachable = await fetch(BASE)
  .then((r) => r.ok)
  .catch(() => false);
if (!reachable) {
  console.error(
    `Nothing serving ${BASE}. Start a PRODUCTION build first:\n` +
      `  pnpm build && pnpm --filter web exec next start -p 3112`,
  );
  process.exit(1);
}


/** Poll from Node (not an in-page rAF loop, which contends with the worker's
 * cache writes) until `probe` returns true or the timeout elapses. */
async function until(probe, timeoutMs = 25_000, everyMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // phone-sized, like the installed app
});
const page = await context.newPage();

// 1) The worker installs and takes control of the page.
await page.goto(BASE, { waitUntil: "load" });
const controlled = await until(() =>
  page.evaluate(
    async () =>
      (await navigator.serviceWorker.getRegistration()) !== undefined &&
      navigator.serviceWorker.controller !== null,
  ),
);
check("service worker registers and takes control", controlled);

// 2) The shell routes and their assets are precached at install time.
// Wait for the install to settle before asserting (and before cutting the
// network below) — precaching the chunks takes a moment after the worker
// takes control.
await until(() =>
  page.evaluate(async () => {
    const names = await caches.keys();
    if (names.length === 0) return false;
    const cache = await caches.open(names[0]);
    const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
    return (
      keys.includes("/") &&
      keys.filter((u) => u.startsWith("/_next/static/")).length >= 10
    );
  }),
);

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const cache = await caches.open(names[0]);
  return (await cache.keys()).map((r) => new URL(r.url).pathname);
});
const staticCount = cached.filter((u) => u.startsWith("/_next/static/")).length;
check(
  "app shell + assets are precached",
  ["/", "/nuevo", "/gastos", "/ajustes", "/datos"].every((p) =>
    cached.includes(p),
  ) &&
    staticCount >= 10,
  `${cached.filter((u) => !u.startsWith("/_next")).join(" ")} + ${staticCount} assets`,
);

// 3) The point of all this: a cold start with the network cut.
await context.setOffline(true);
let offline = false;
try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Gastos", { timeout: 10_000 });
  offline = true;
} catch {
  offline = false;
}
check("app boots with the network offline", offline);

// 4) Including routes this session never visited — /nuevo above all, since
// adding an expense is what you open the app for when there is no signal.
let deepRoute = false;
try {
  await page.goto(`${BASE}/ajustes`, { waitUntil: "domcontentloaded" });
  deepRoute = (await page.title()).length > 0;
  // Nobody is signed in here, so what these routes render offline is the
  // sign-in screen — which is exactly the proof wanted: the SPA booted from
  // the cache rather than showing the browser's offline error page.
  await page.goto(`${BASE}/nuevo`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Continuar con Google", { timeout: 10_000 });
} catch {
  deepRoute = false;
}
check("unvisited routes open offline (incl. quick entry)", deepRoute);

// 5) The auth handler must never be served from the cache.
await context.setOffline(false);
// Re-navigate first: evaluating straight after the previous goto can race the
// execution context being torn down.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
let authStatus = 0;
try {
  authStatus = await page.evaluate(() =>
    fetch("/__/auth/handler").then((r) => r.status),
  );
} catch (error) {
  console.error(`  (auth handler probe failed: ${String(error).slice(0, 120)})`);
}
check("auth handler bypasses the cache", authStatus === 200, `HTTP ${authStatus}`);

await browser.close();
process.exit(failures === 0 ? 0 : 1);
