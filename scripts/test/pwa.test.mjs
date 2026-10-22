import assert from "node:assert/strict";
import { test } from "node:test";
import { KyberError } from "../lib/errors.mjs";
import { REQUIRED, precacheVerdict, pwaProblems, requirePwa } from "../lib/pwa.mjs";

const PWA = {
  port: 3100,
  entry: "/home",
  precachedRoutes: ["/home", "/list", "/settings"],
  minStaticAssets: 5,
  offlineText: "Fixture",
  deepRoute: "/list",
  signedOutText: "Continue with Google",
};

const cachedFor = (routes, assets) => [
  ...routes,
  ...Array.from({ length: assets }, (_, i) => `/_next/static/chunk-${i}.js`),
];

test("a complete pwa block has no problems", () => {
  assert.deepEqual(pwaProblems(PWA), []);
  assert.equal(requirePwa(PWA), PWA);
});

test("a missing block, and every missing key, is named", () => {
  assert.deepEqual(pwaProblems(undefined), ['"scripts/project.json" has no "pwa" block']);
  // Derived from REQUIRED, not a second copy of it. The list used to be typed
  // out here and coupled only by a count, which answers "how many" to a
  // question that was "which ones": add a required key and the failure reads
  // "expected 6 to equal 5" instead of naming it.
  const expected = REQUIRED.filter((k) => k !== "port");
  assert.ok(expected.length > 3, `only ${expected.length} keys to check`);
  const problems = pwaProblems({ port: 3100 });
  assert.equal(problems.length, expected.length);
  for (const key of expected) {
    assert.ok(problems.some((p) => p.includes(`"pwa.${key}"`)), `${key} not named`);
  }
});

test("the entry has to be one of the precached routes", () => {
  // The entry is where the worker is installed from, so a shell that leaves it
  // out caches everything except the way in.
  const problems = pwaProblems({ ...PWA, entry: "/elsewhere" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"pwa\.entry" \(\/elsewhere\) is not in "pwa\.precachedRoutes"/);
});

test("so does the deep route", () => {
  const problems = pwaProblems({ ...PWA, deepRoute: "/never-cached" });
  assert.match(problems.join("\n"), /"pwa\.deepRoute" \(\/never-cached\)/);
});

test("routes must be paths, and the numbers must be numbers", () => {
  assert.match(pwaProblems({ ...PWA, precachedRoutes: ["home"] }).join(), /starting with "\/"/);
  assert.match(pwaProblems({ ...PWA, precachedRoutes: [] }).join(), /non-empty array/);
  assert.match(pwaProblems({ ...PWA, port: "3100" }).join(), /"pwa\.port" must be a whole number/);
  assert.match(pwaProblems({ ...PWA, minStaticAssets: 0 }).join(), /above zero/);
});

test("requirePwa throws a message listing everything wrong at once", () => {
  assert.throws(
    () => requirePwa({ port: 3100 }),
    (error) =>
      error instanceof KyberError &&
      error.message.includes('"pwa.entry" is missing') &&
      error.message.includes('"pwa.deepRoute" is missing'),
  );
});

test("the shell and its assets both have to be there", () => {
  const ok = precacheVerdict(cachedFor(PWA.precachedRoutes, 6), PWA);
  assert.equal(ok.pass, true);
  assert.equal(ok.staticAssets, 6);
});

test("a cached shell with too little code is a fail, which is the bug it exists for", () => {
  // The HTML cached and none of the chunks it points at: an offline reload
  // finds the page and nothing it needs. This used to read as a pass.
  const thin = precacheVerdict(cachedFor(PWA.precachedRoutes, 2), PWA);
  assert.equal(thin.pass, false);
  assert.equal(thin.staticAssets, 2);
});

test("a missing route fails and the detail says which one", () => {
  const partial = precacheVerdict(cachedFor(["/home", "/settings"], 9), PWA);
  assert.equal(partial.pass, false);
  assert.deepEqual(partial.missingRoutes, ["/list"]);
  assert.match(partial.detail, /missing \/list/);
});

test("an empty cache is a fail, not an empty pass", () => {
  const none = precacheVerdict([], PWA);
  assert.equal(none.pass, false);
  assert.deepEqual(none.missingRoutes, PWA.precachedRoutes);
});
