import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The OAuth callback scheme iOS registers must be the one Firebase issued.
 *
 * Google Sign-In comes back to the app through a custom URL scheme, and that
 * scheme IS the `REVERSED_CLIENT_ID` of the OAuth client Firebase created for
 * this iOS app. The value therefore exists three times: once in
 * `GoogleService-Info.plist`, which Firebase writes and which is the source;
 * once as a literal in `project.yml`; and once in the `Info.plist` that
 * xcodegen produces from it.
 *
 * Nothing held those three together. The comment beside the literal said
 * "Checked by GastosTests" and no test in that bundle names it — a sentence
 * that had been asserting a guard into existence for as long as it had been
 * written. This is that guard.
 *
 * What it prevents is specific and quiet: registering a NEW iOS app in
 * Firebase mints a NEW OAuth client, so replacing only `GoogleService-Info`
 * leaves the app asking to come back to a scheme that no longer belongs to it.
 * Sign-in is refused with nothing on screen explaining why, and nothing in
 * the build says a word.
 *
 * It lives here rather than in GastosTests because this suite runs on every
 * push through the hook, with no simulator, and a value copied between two
 * plists is checkable by reading them.
 */
describe("the Google Sign-In callback scheme", () => {
  const IOS = join(import.meta.dirname, "../../../../apps/ios");
  const read = (p: string) => readFileSync(join(IOS, p), "utf8");

  /** `<key>NAME</key>` followed by its `<string>`, which is how plists nest. */
  function plistValue(xml: string, key: string): string | undefined {
    const m = new RegExp(
      `<key>${key}</key>\\s*<string>([^<]*)</string>`,
    ).exec(xml);
    return m?.[1];
  }

  it("is the REVERSED_CLIENT_ID Firebase issued, in every file that spells it", () => {
    const firebase = plistValue(
      read("Gastos/Resources/GoogleService-Info.plist"),
      "REVERSED_CLIENT_ID",
    );
    expect(
      firebase,
      "GoogleService-Info.plist has no REVERSED_CLIENT_ID — wrong file or a broken download",
    ).toMatch(/^com\.googleusercontent\.apps\./);

    // Derived from the source rather than typed again here: a guard that
    // spells the value it holds is the next copy nobody couples.
    const clientId = plistValue(
      read("Gastos/Resources/GoogleService-Info.plist"),
      "CLIENT_ID",
    );
    expect(
      firebase,
      "REVERSED_CLIENT_ID is not CLIENT_ID reversed — one of the two was edited by hand",
    ).toBe(`com.googleusercontent.apps.${clientId?.replace(/\.apps\.googleusercontent\.com$/, "")}`);

    // Both of the files that copy it. project.yml is what a person edits;
    // Info.plist is what xcodegen wrote from it and what the device reads, and
    // they go out of step whenever someone edits one and does not regenerate —
    // the same gap that makes the version guard check both.
    for (const file of ["project.yml", "Gastos/Info.plist"]) {
      expect(
        read(file),
        `${file} does not carry the scheme Firebase issued`,
      ).toContain(firebase as string);
    }
  });
});
