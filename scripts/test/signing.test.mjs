import assert from "node:assert/strict";
import { test } from "node:test";
import { KyberError } from "../lib/errors.mjs";
import { belongsToApp, signingVerdict, versionVerdict } from "../lib/signing.mjs";

const BUNDLE = "dev.example.app";
const at = (days, hours = 0) => new Date(Date.UTC(2026, 8, 15) + days * 86_400_000 + hours * 3_600_000);
const NOW = new Date(Date.UTC(2026, 8, 15));

test("the app's own profile, and its extensions, belong to it", () => {
  for (const id of [
    "TEAMID.dev.example.app",
    "TEAMID.dev.example.app.widget",
    "TEAMID.dev.example.app.watchkitapp",
  ]) {
    assert.equal(belongsToApp(id, BUNDLE), true, id);
  }
});

test("another project's profile does not, even when the name overlaps", () => {
  // Measured on the machine these run on: thirteen profiles, three projects,
  // two teams. A substring match would move somebody else's aside — and since
  // a profile is only restored when the build FAILS, a success deletes it.
  for (const id of [
    "TEAMID.dev.example.apparel",
    "OTHERTEAM.ai.someone.app",
    "TEAMID.*",
    "no-dot-at-all",
  ]) {
    assert.equal(belongsToApp(id, BUNDLE), false, id);
  }
  assert.equal(belongsToApp(undefined, BUNDLE), false);
});

test("the shortest signature rules, not the app's", () => {
  // The app's own profile can be the longest while an extension expires
  // first; the one that stops the app opening is the shortest.
  const verdict = signingVerdict(
    [
      { name: "app", expiry: at(7) },
      { name: "watch", expiry: at(2) },
      { name: "widget", expiry: at(5) },
    ],
    NOW,
  );
  assert.equal(verdict.soonest.name, "watch");
  assert.equal(verdict.days, 2);
  assert.equal(verdict.fresh, true);
});

test("under a day is refused, which is what a silent non-renewal looks like", () => {
  const verdict = signingVerdict([{ name: "app", expiry: at(0, 23) }], NOW);
  assert.equal(verdict.fresh, false);
  assert.equal(verdict.days, 0);
  assert.equal(verdict.hours, 23);
});

test("exactly a day is fresh; a minute under is not", () => {
  assert.equal(signingVerdict([{ name: "a", expiry: at(1) }], NOW).fresh, true);
  const justUnder = new Date(at(1).getTime() - 60_000);
  assert.equal(signingVerdict([{ name: "a", expiry: justUnder }], NOW).fresh, false);
});

test("a bundle with no profile at all is an error, not an empty pass", () => {
  assert.throws(() => signingVerdict([], NOW), KyberError);
});

test("the shipped version has to equal the declared one", () => {
  assert.equal(versionVerdict("1.2.0", "1.2.0").agrees, true);
  // The measured bug: the project file carried a literal while the version
  // guard was green, so the phone showed an old number for days.
  assert.equal(versionVerdict("0.1", "1.0.0").agrees, false);
  assert.equal(versionVerdict("(sin clave)", "1.0.0").agrees, false);
});
