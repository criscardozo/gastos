#!/usr/bin/env node
// PWA smoke check: proves the installed app can cold-start with no network.
//
// The service worker only registers in PRODUCTION builds, so this runs against
// a real `next start` and not the dev server — pointed at a dev server it
// passes without testing anything, which is worse than failing. It is kept out
// of any Playwright config on purpose: it needs a production server, not the
// emulators the end-to-end suite runs against.
//
//   pnpm build && pnpm --filter web exec next start -p <pwa.port> &
//   node scripts/verify-pwa.mjs
//
// Nobody is signed in, so what a route renders offline is the sign-in screen.
// That IS the proof wanted: the app booted from the cache instead of showing
// the browser's own offline error page.
//
// Reads from scripts/project.json: the whole `pwa` block, and `webDir` for
// finding the consumer's Playwright.

import { join } from "node:path";
import { loadConsumer } from "./lib/consumer.mjs";
import { importFrom } from "./lib/bin.mjs";
import { run } from "./lib/errors.mjs";
import { precacheVerdict, requirePwa } from "./lib/pwa.mjs";

let failures = 0;
function check(label, pass, extra = "") {
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
}

/**
 * Poll from Node rather than an in-page loop, which contends with the worker's
 * own cache writes.
 */
async function until(probe, timeoutMs = 25_000, everyMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return false;
}

async function main() {
  const { root, config, dir } = loadConsumer({ required: [] });
  const pwa = requirePwa(config.pwa);
  const webDir = config.webDir ? dir("webDir") : join(root, "apps", "web");
  const base = process.env.PWA_BASE_URL ?? `http://localhost:${pwa.port}`;
  const entry = `${base}${pwa.entry}`;

  const reachable = await fetch(entry).then((r) => r.ok).catch(() => false);
  if (!reachable) {
    console.error(
      `Nothing serving ${entry}. Start a PRODUCTION build first:\n` +
        `  pnpm build && pnpm --filter web exec next start -p ${pwa.port}`,
    );
    process.exit(1);
  }

  const { chromium } = await importFrom(webDir, "@playwright/test");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // phone-sized, like the installed app
  });
  const page = await context.newPage();

  // 1) The worker installs and takes control of the page.
  await page.goto(entry, { waitUntil: "load" });
  const controlled = await until(() =>
    page.evaluate(
      async () =>
        (await navigator.serviceWorker.getRegistration()) !== undefined &&
        navigator.serviceWorker.controller !== null,
    ),
  );
  check("service worker registers and takes control", controlled);

  // 2) The shell routes AND the hashed assets they point at. The assets are
  // the half that used to be missing: with the HTML cached and none of the
  // code, an offline reload finds the page and nothing it needs.
  // Every cache, not the first one: both consumers keep a single cache
  // today, and the first name is only the right one for as long as that
  // stays true. A worker that opens a runtime cache before its precache
  // finishes would have failed this with every route "missing".
  const readCache = () =>
    page.evaluate(async () => {
      const paths = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
      }
      return paths;
    });
  // Let the install settle before asserting, and before cutting the network.
  await until(async () => precacheVerdict(await readCache(), pwa).pass);
  const verdict = precacheVerdict(await readCache(), pwa);
  check("app shell + assets are precached", verdict.pass, verdict.detail);

  // 3) The point of all of it: a cold start with the network cut.
  await context.setOffline(true);
  let offline = false;
  try {
    await page.goto(entry, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`text=${pwa.offlineText}`, { timeout: 10_000 });
    offline = true;
  } catch {
    offline = false;
  }
  check("app boots with the network offline", offline);

  // 4) Including a route this session never opened — the one that matters is
  // whichever the app is opened for when there is no signal.
  let deepRoute = false;
  try {
    await page.goto(`${base}${pwa.deepRoute}`, { waitUntil: "domcontentloaded" });
    const marker = pwa.signedOutText ?? pwa.offlineText;
    await page.waitForSelector(`text=${marker}`, { timeout: 10_000 });
    deepRoute = true;
  } catch {
    deepRoute = false;
  }
  check(`unvisited routes open offline (${pwa.deepRoute})`, deepRoute);

  // 5) The auth handler must never come from the cache: caching a token
  // exchange breaks sign-in, and it is same-origin because the app rewrites it
  // so Safari's tracking prevention does not eat the handshake.
  await context.setOffline(false);
  // Re-navigate first: evaluating straight after the previous goto can race
  // the execution context being torn down.
  await page.goto(entry, { waitUntil: "domcontentloaded" });
  let authStatus = 0;
  try {
    authStatus = await page.evaluate(() => fetch("/__/auth/handler").then((r) => r.status));
  } catch (error) {
    console.error(`  (auth handler probe failed: ${String(error).slice(0, 120)})`);
  }
  check("auth handler bypasses the cache", authStatus === 200, `HTTP ${authStatus}`);

  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

run(main, {
  usage: "Usage: node scripts/verify-pwa.mjs\n  Takes no arguments.",
});
