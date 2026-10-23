// The decidable parts of installing on a phone with a free team, kept out of
// the shelling-out so they can be tested.

import { ScriptError } from "./errors.mjs";

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
    throw new ScriptError(
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

/**
 * How many Apple IDs Xcode has, from `defaults read com.apple.dt.Xcode
 * DVTDeveloperAccountManagerAppleIDLists`. `null` output (the key is absent)
 * counts as none.
 *
 * This is the one signing fact observable from a shell: the credential itself
 * lives in the data-protection keychain, which `security` cannot enumerate.
 * An empty list is fatal for `-allowProvisioningUpdates`, and it is what
 * xcodebuild leaves behind after failing to load a credential, so it covers
 * both "never added" and "pruned after a lost credential". Measured on
 * 2026-10-23: empty, the build failed with "No Accounts"; with one entry
 * after re-adding the account in Xcode, it signed.
 */
export function xcodeAccountCount(defaultsOutput) {
  if (defaultsOutput === null) return 0;
  return (defaultsOutput.match(/\bidentifier\s*=/g) ?? []).length;
}

/**
 * What to tell the person at the keyboard, by whether the account is still
 * listed. The old message always said "Sign In", which does not exist for an
 * account that is no longer there — the fix then is adding it again with +.
 */
export function accountAdvice(count) {
  return count === 0
    ? "Xcode no tiene ninguna Apple ID cargada, así que no puede pedir perfiles.\n" +
        "   Se arregla en Xcode -> Settings -> Accounts -> + -> Apple ID, entrando\n" +
        "   con la cuenta del team, y corriendo esto otra vez."
    : "La cuenta está en Xcode pero no se pudo cargar su credencial del keychain.\n" +
        "   Se arregla en Xcode -> Settings -> Accounts -> la cuenta -> Sign In,\n" +
        "   y corriendo esto otra vez.";
}
