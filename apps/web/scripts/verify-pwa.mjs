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

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // phone-sized, like the installed app
});
const page = await context.newPage();

// 1) The worker installs and takes control of the page.
await page.goto(BASE, { waitUntil: "load" });
const controlled = await page
  .waitForFunction(
    async () =>
      (await navigator.serviceWorker.getRegistration()) !== undefined &&
      navigator.serviceWorker.controller !== null,
    null,
    { timeout: 20_000 },
  )
  .then(() => true)
  .catch(() => false);
check("service worker registers and takes control", controlled);

// 2) The shell routes are precached at install time.
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const cache = await caches.open(names[0]);
  return (await cache.keys()).map((r) => new URL(r.url).pathname);
});
check(
  "app shell is precached",
  ["/", "/gastos", "/ajustes", "/datos"].every((p) => cached.includes(p)),
  cached.filter((u) => !u.startsWith("/_next")).join(" "),
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

// 4) Including a route this session never visited.
let deepRoute = false;
try {
  await page.goto(`${BASE}/ajustes`, { waitUntil: "domcontentloaded" });
  deepRoute = (await page.title()).length > 0;
} catch {
  deepRoute = false;
}
check("an unvisited route opens offline", deepRoute);

// 5) The auth handler must never be served from the cache.
await context.setOffline(false);
const authStatus = await page.evaluate(() =>
  fetch("/__/auth/handler").then((r) => r.status),
);
check("auth handler bypasses the cache", authStatus === 200, `HTTP ${authStatus}`);

await browser.close();
process.exit(failures === 0 ? 0 : 1);
