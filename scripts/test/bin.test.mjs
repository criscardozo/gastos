import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importFrom, resolveBin } from "../lib/bin.mjs";
import { ScriptError } from "../lib/errors.mjs";

function fakePackage(root, name, manifest) {
  const dir = join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0", ...manifest }));
  return dir;
}

test("resolveBin follows the package's own bin field, object or string form", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gastos-bin-")));
  const nested = join(root, "firebase", "rules-tests");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), "{}");
  const tools = fakePackage(root, "fake-tools", { bin: { fake: "./lib/bin/fake.js" } });
  const single = fakePackage(root, "single-bin", { bin: "./cli.mjs" });
  // Resolved from the nested package, found at the workspace root: the
  // arrangement where one project keeps the tool in the root manifest.
  assert.equal(resolveBin(nested, "fake-tools", "fake"), join(tools, "lib/bin/fake.js"));
  assert.equal(resolveBin(nested, "single-bin", "whatever"), join(single, "cli.mjs"));
});

test("resolveBin says which package is missing and how to install it", () => {
  const root = mkdtempSync(join(tmpdir(), "gastos-bin-"));
  writeFileSync(join(root, "package.json"), "{}");
  assert.throws(
    () => resolveBin(root, "not-installed-anywhere", "x"),
    (error) => error instanceof ScriptError && error.message.includes("pnpm install"),
  );
  fakePackage(root, "no-bin", {});
  assert.throws(() => resolveBin(root, "no-bin", "x"), /declares no "x"/);
});

test("importFrom gives named access to a CommonJS package", async () => {
  // The bug this exists for: a CJS package reached through dynamic import puts
  // everything on `default`, so destructuring a named export yields undefined
  // and the caller crashes on a package that is installed and working. An ESM
  // fixture does not reproduce it.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gastos-cjs-")));
  writeFileSync(join(root, "package.json"), "{}");
  const cjs = join(root, "node_modules", "cjs-pkg");
  mkdirSync(cjs, { recursive: true });
  writeFileSync(join(cjs, "package.json"), JSON.stringify({ name: "cjs-pkg", main: "index.js" }));
  writeFileSync(join(cjs, "index.js"), "module.exports = { chromium: { launch: () => 'ok' } };\n");

  const mod = await importFrom(root, "cjs-pkg");
  assert.equal(typeof mod.chromium, "object", "named export not reachable");
  assert.equal(mod.chromium.launch(), "ok");
});

test("importFrom handles a CommonJS package whose export is a callable", async () => {
  // The shape that defeated the first fix. A CJS package can set
  // module.exports to a function and hang its named exports off it — which is
  // what the real one does — so a check for `typeof default === "object"`
  // passes the unit test with an object fixture and fails in the field.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gastos-cjsfn-")));
  writeFileSync(join(root, "package.json"), "{}");
  const cjs = join(root, "node_modules", "cjs-callable");
  mkdirSync(cjs, { recursive: true });
  writeFileSync(join(cjs, "package.json"), JSON.stringify({ name: "cjs-callable", main: "index.js" }));
  writeFileSync(
    join(cjs, "index.js"),
    "function test() {}\ntest.chromium = { launch: () => 'ok' };\nmodule.exports = test;\n",
  );

  const mod = await importFrom(root, "cjs-callable");
  assert.equal(typeof mod.chromium, "object", "named export not reachable on a callable export");
  assert.equal(mod.chromium.launch(), "ok");
});

test("importFrom does not shadow a real ESM module's named exports", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gastos-esm-")));
  writeFileSync(join(root, "package.json"), "{}");
  const esm = join(root, "node_modules", "esm-pkg");
  mkdirSync(esm, { recursive: true });
  writeFileSync(join(esm, "package.json"), JSON.stringify({ name: "esm-pkg", type: "module", main: "index.mjs" }));
  // A default export that is an object AND a named one: preferring `default`
  // unconditionally would hand back the wrong thing here.
  writeFileSync(join(esm, "index.mjs"), "export const chromium = { launch: () => 'named' };\nexport default { chromium: { launch: () => 'default' } };\n");

  const mod = await importFrom(root, "esm-pkg");
  assert.equal(mod.chromium.launch(), "named");
});
