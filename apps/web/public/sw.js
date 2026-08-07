/* Service worker — makes the installed PWA start and work offline.
 *
 * Deliberately small and explicit rather than a generated precache manifest:
 * the one thing that MUST NOT happen is interfering with Firestore. Its
 * streaming/long-poll requests are cross-origin and manage their own offline
 * persistence (IndexedDB), so this worker handles ONLY same-origin GETs and
 * lets everything else go straight to the network, untouched.
 *
 * Strategies
 *   /_next/static/*  cache-first  — content-hashed, immutable by construction
 *   navigations      network-first with a cached fallback (offline launch)
 *   other same-origin GETs (icons, manifest)  stale-while-revalidate
 *
 * Bump VERSION to retire every old cache on the next activation.
 */

const VERSION = "v3";
const CACHE = `gd-${VERSION}`;

/** Routes worth having available on a cold offline start. `/nuevo` matters
 * most of all: it is the phone's quick entry, the one screen you actually
 * reach for with no signal, and it was the only route missing here. */
const SHELL = [
  "/",
  "/nuevo",
  "/gastos",
  "/datos",
  "/ajustes",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, so one 404 can't fail the whole install.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await precacheShellAssets(cache);
      await self.skipWaiting();
    })(),
  );
});

/**
 * Cache the JS/CSS the shell references.
 *
 * Without this the FIRST visit is not actually offline-capable: the page's
 * chunks were already fetched before this worker took control, so they never
 * entered the cache and an offline reload would render an empty shell. The
 * asset URLs aren't known at author time, so they're read out of the shell
 * HTML we just cached. Fonts live in the CSS and are picked up on first use.
 */
async function precacheShellAssets(cache) {
  try {
    const response = await cache.match("/");
    if (response === undefined) return;
    const html = await response.text();
    const urls = new Set(
      [...html.matchAll(/["'](\/_next\/static\/[^"']+)["']/g)].map((m) => m[1]),
    );
    await Promise.allSettled([...urls].map((url) => cache.add(url)));
  } catch {
    // Best effort: a partial precache still beats none, and everything is
    // cached on demand as soon as it's requested through the worker.
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never touch non-GET (writes) or cross-origin (Firestore, Google auth, FX).
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The proxied Firebase auth handler must always hit the network.
  if (url.pathname.startsWith("/__/auth")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

/** Fresh HTML when online; the last good copy (or the app shell) when not. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match("/")) ??
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? Response.error();
}
