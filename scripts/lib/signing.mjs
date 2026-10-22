// The decidable parts of installing on a phone with a free team, kept out of
// the shelling-out so they can be tested.

import { KyberError } from "./errors.mjs";

/**
 * Does a provisioning profile belong to this app?
 *
 * The entitlement is `TEAMID.bundle.id`, so the team prefix comes off and what
 * is left must BE the bundle id or be a child of it — that is how the widget
 * and the watch app come along, which they must: Xcode reissues in one pass
 * only what is missing, so a profile left behind keeps its old date, and the
 * one that stops working first is the SHORTEST, not the app's.
 *
 * An exact match and not a substring. Measured on the machine these run on:
 * thirteen profiles from three projects across two teams. A bare substring is
 * one unlucky name away from moving somebody else's profile aside — and since
 * a profile is only put back when the build FAILS, a successful build would
 * delete it for good.
 */
export function belongsToApp(applicationIdentifier, bundleId) {
  if (typeof applicationIdentifier !== "string") return false;
  const dot = applicationIdentifier.indexOf(".");
  if (dot === -1) return false;
  const id = applicationIdentifier.slice(dot + 1);
  return id === bundleId || id.startsWith(`${bundleId}.`);
}

/**
 * The verdict on a freshly issued set of signatures.
 *
 * `profiles` is `{ name, expiry }[]`. The shortest one rules, because it is
 * the one that stops the app opening. Under a day means the reissue did not
 * actually happen — which is exactly what a silent failure looks like from
 * here, and the reason not to install something that dies tomorrow.
 */
export function signingVerdict(profiles, now = new Date()) {
  if (profiles.length === 0) {
    throw new KyberError(
      "The built app has no embedded.mobileprovision at all, so nothing was signed.",
    );
  }
  const sorted = [...profiles].sort((a, b) => a.expiry - b.expiry);
  const soonest = sorted[0];
  const msLeft = soonest.expiry - now;
  return {
    soonest,
    msLeft,
    days: Math.floor(msLeft / 86_400_000),
    hours: Math.floor((msLeft % 86_400_000) / 3_600_000),
    fresh: msLeft >= 86_400_000,
    sorted,
  };
}

/**
 * What the built bundle will SHOW against what the project declares.
 *
 * Not the same question as the version guard, which reads the tracked files —
 * those hold `$(MARKETING_VERSION)`, and only the built bundle has the
 * substituted value. A literal in the project file once put an old number on
 * screen for days with every version check green. This measures the
 * connection rather than the setting.
 */
export function versionVerdict(shipped, declared) {
  return { shipped, declared, agrees: shipped === declared };
}
