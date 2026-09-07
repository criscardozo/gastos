import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The iOS Google Sign-In config, held to the plist Firebase issued.
 *
 * `project.yml` carries the OAuth client id twice — once as `GIDClientID` and
 * once as the reversed form in `CFBundleURLSchemes` — and both are copied by
 * hand from `GoogleService-Info.plist`, which is right beside them. Registering
 * a NEW iOS app in Firebase issues a NEW client, so the pair goes stale exactly
 * when the bundle id changes, and the failure is Google refusing the sign-in
 * with nothing on the device to say why.
 *
 * That happened: the rebrand swapped the plist and left both copies pointing at
 * the retired client. In the web suite for the same reason `limits.test.ts` and
 * `categories.test.ts` read Swift sources — it is the only suite CI runs, and a
 * guard nothing runs is a comment.
 */

const ROOT = join(import.meta.dirname, "../../../..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

const plist = read("apps/ios/Gastos/Resources/GoogleService-Info.plist");
const project = read("apps/ios/project.yml");

/** The string under `<key>NAME</key>` in a plist. */
function plistValue(key: string): string {
  const match = plist.match(
    new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`),
  );
  expect(match, `${key} not found in GoogleService-Info.plist`).not.toBeNull();
  return match![1];
}

describe("the iOS app's Firebase config", () => {
  it("is for the bundle id the project builds", () => {
    const bundleId = project.match(
      /PRODUCT_BUNDLE_IDENTIFIER: (dev\.cardozo\.[a-z]+)\s*$/m,
    );
    expect(bundleId, "the app's bundle id was not found").not.toBeNull();
    expect(plistValue("BUNDLE_ID")).toBe(bundleId![1]);
  });

  it("names the same OAuth client the sign-in asks for", () => {
    expect(project).toContain(`GIDClientID: ${plistValue("CLIENT_ID")}`);
  });

  it("...and the same one again as the URL scheme that receives the callback", () => {
    // Two copies of one id, and only one of them is obvious when it is wrong:
    // with a stale scheme the browser opens and never comes back.
    expect(project).toContain(`- ${plistValue("REVERSED_CLIENT_ID")}`);
  });

  it("is still the project the rest of the repo talks to", () => {
    // The project id is permanent — Firebase cannot rename one — so a plist
    // from a different project would be a different database.
    expect(plistValue("PROJECT_ID")).toBe("qcris-gastos-diarios");
  });
});

describe("the name the phone shows", () => {
  it("is set in project.yml, on all three bundles", () => {
    // In project.yml and NOT in the Info.plists, because xcodegen regenerates
    // those from `info: properties:` — an edit to a generated plist is undone
    // by the next `xcodegen`, which is how the old label survived an install
    // that reported success.
    const names = [...project.matchAll(/CFBundleDisplayName: (.+)$/gm)].map(
      (m) => m[1].trim(),
    );
    expect(names).toEqual(["Gastos", "Gastos", "Gastos"]);
  });

  it("is not left anywhere as the old one", () => {
    // Searched as a regex across a line break too: the login title was
    // `Text(verbatim: "Gastos\nDiarios")` on iOS and `Gastos<br />Diarios` on
    // the web, so a plain search for "Gastos Diarios" found neither. Both are
    // gone; this is what keeps them gone.
    for (const path of [
      "apps/ios/project.yml",
      "apps/ios/Gastos/Features/Onboarding/OnboardingView.swift",
      "apps/web/src/components/onboarding/onboarding.tsx",
      "apps/web/src/app/manifest.webmanifest",
      "apps/web/messages/es.json",
      "apps/web/messages/en.json",
    ]) {
      expect(read(path), path).not.toMatch(/Gastos\s*(\\n|<br \/>|\s)\s*Diarios/);
    }
  });
});
