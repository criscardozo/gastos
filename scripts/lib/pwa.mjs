// The decidable half of the PWA smoke check, kept out of the browser driving
// so it can be tested without one.
//
// The check itself is the same five steps in every consumer; everything that
// differs between them is a value: the port, the entry route, the shell routes,
// how many hashed assets count as "the code came too", and the two bits of text
// that prove a page rendered rather than the browser's offline error.

import { KyberError } from "./errors.mjs";

/**
 * The keys a `pwa` block must carry. Exported so the test derives its list
 * from this one instead of keeping a second copy: a hand-written list in a
 * guard is an uncoupled copy even when every entry it holds is checked, and
 * what it stops checking is its own MEMBERSHIP. Add a key here and a test
 * naming five would go on naming five.
 */
export const REQUIRED = [
  "port",
  "entry",
  "precachedRoutes",
  "minStaticAssets",
  "offlineText",
  "deepRoute",
];

/** Everything wrong with a consumer's `pwa` block, named. */
export function pwaProblems(pwa) {
  if (pwa === undefined || pwa === null || typeof pwa !== "object") {
    return ['"scripts/project.json" has no "pwa" block'];
  }
  const problems = [];
  for (const key of REQUIRED) {
    if (pwa[key] === undefined) problems.push(`"pwa.${key}" is missing`);
  }
  if (pwa.port !== undefined && !Number.isInteger(pwa.port)) {
    problems.push('"pwa.port" must be a whole number');
  }
  if (pwa.precachedRoutes !== undefined) {
    if (!Array.isArray(pwa.precachedRoutes) || pwa.precachedRoutes.length === 0) {
      problems.push('"pwa.precachedRoutes" must be a non-empty array of paths');
    } else if (!pwa.precachedRoutes.every((r) => typeof r === "string" && r.startsWith("/"))) {
      problems.push('every "pwa.precachedRoutes" entry must be a path starting with "/"');
    } else if (pwa.entry !== undefined && !pwa.precachedRoutes.includes(pwa.entry)) {
      // The entry is the route the worker is installed from, so a shell that
      // does not include it caches everything except the way in.
      problems.push(`"pwa.entry" (${pwa.entry}) is not in "pwa.precachedRoutes"`);
    }
  }
  if (pwa.minStaticAssets !== undefined && !(Number.isInteger(pwa.minStaticAssets) && pwa.minStaticAssets > 0)) {
    problems.push('"pwa.minStaticAssets" must be a whole number above zero');
  }
  if (pwa.deepRoute !== undefined && pwa.precachedRoutes?.includes?.(pwa.deepRoute) === false) {
    problems.push(`"pwa.deepRoute" (${pwa.deepRoute}) is not in "pwa.precachedRoutes"`);
  }
  return problems;
}

export function requirePwa(pwa) {
  const problems = pwaProblems(pwa);
  if (problems.length > 0) {
    throw new KyberError(
      "The PWA check needs a complete \"pwa\" block in scripts/project.json:\n" +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
  return pwa;
}

/**
 * Did the worker precache the shell AND the code it points at?
 *
 * The assets are the half that used to be missing: with the HTML cached and
 * none of the hashed chunks, a first-visit offline reload finds the page and
 * nothing it needs, which looks like the check passing and the app broken.
 */
export function precacheVerdict(cachedPaths, pwa) {
  const staticAssets = cachedPaths.filter((p) => p.startsWith("/_next/static/")).length;
  const missingRoutes = pwa.precachedRoutes.filter((r) => !cachedPaths.includes(r));
  return {
    pass: missingRoutes.length === 0 && staticAssets >= pwa.minStaticAssets,
    missingRoutes,
    staticAssets,
    detail:
      `${cachedPaths.filter((p) => !p.startsWith("/_next")).join(" ")} + ${staticAssets} assets` +
      (missingRoutes.length > 0 ? ` — missing ${missingRoutes.join(" ")}` : ""),
  };
}
