import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The state colours, held to the same values in every file that names them.
 *
 * They live in four places that cannot read each other: `globals.css` twice
 * (light, and the dark override), iOS's `Theme.swift`, and `tokens.md`, which
 * is the document telling the next person not to invent colours. A hex is the
 * kind of copy nothing checks — no refactor touches it, no grep for an
 * identifier finds it — which is how `docs/` ended up naming the old emulator
 * ports for two days.
 *
 * Prose is included deliberately. It was the copy that went stale last time,
 * and a design document that disagrees with the code is worse than none: it
 * is the file somebody trusts.
 */

const ROOT = join(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const CSS = read("apps/web/src/app/globals.css");
const SWIFT = read("apps/ios/Gastos/Design/Theme.swift");
const DOC = read("docs/design/tokens.md");

/** `--name: #abc123;` → `#ABC123`, from the FIRST (light) definition. */
function cssHex(name: string): string {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(match, `--${name} in globals.css`).not.toBeNull();
  return (match as RegExpMatchArray)[1].toUpperCase();
}

/** Every hex the Swift line for `name` mentions, light first. */
function swiftHexes(name: string): string[] {
  const line = SWIFT.split("\n").find((l) =>
    l.includes(`static let ${name} = `),
  );
  expect(line, `static let ${name} in Theme.swift`).toBeDefined();
  return [...(line as string).matchAll(/#[0-9a-fA-F]{6}/g)].map((m) =>
    m[0].toUpperCase(),
  );
}

describe("the state colours agree everywhere they are written", () => {
  it("has tokens to compare in the first place", () => {
    // Without this, a rename would empty every list below and pass.
    expect(CSS).toContain("--info:");
    expect(SWIFT).toContain("static let info");
    expect(DOC.length).toBeGreaterThan(500);
  });

  it.each([
    ["info", "info", "#1F7FA8", "#4FB3D4"],
    ["good", "green", "#2E9E5B", "#40BE74"],
    ["warn", "amber", "#E39A0C", null],
    ["over", "red", "#E5484D", null],
  ])(
    "%s is the same colour in CSS and in Swift",
    (cssName, swiftName, light, dark) => {
      expect(cssHex(cssName)).toBe(light);
      const swift = swiftHexes(swiftName);
      expect(swift[0]).toBe(light);
      if (dark !== null) expect(swift[1]).toBe(dark);
    },
  );

  it.each(["info", "good", "warn", "over"])(
    "%s and its text colour are both in tokens.md",
    (name) => {
      // Read from the stylesheet rather than written here: this used to spell
      // the text hexes out, which made it one more copy to update — and the
      // day the text colours moved for contrast, it was the copy that failed
      // instead of the doc. Case-insensitively: the doc writes them upper.
      expect(DOC.toUpperCase()).toContain(cssHex(name));
      expect(DOC.toUpperCase()).toContain(cssHex(`${name}-text`));
    },
  );

  it("draws the Visa wordmark in the same blue on both platforms", () => {
    // Hand-written on both sides — globals.css's --visa and CardMark.swift —
    // because neither is a design token the emitter manages. Both themes: the
    // dark value is the one that keeps the wordmark legible on a dark card.
    const mark = read("apps/ios/Gastos/Design/CardMark.swift");
    const line = mark.split("\n").find((l) => l.includes("static let visaBlue"));
    expect(line, "static let visaBlue in CardMark.swift").toBeDefined();
    const swift = [...(line as string).matchAll(/#[0-9a-fA-F]{6}/g)].map((m) =>
      m[0].toUpperCase(),
    );
    const dark = CSS.match(
      /:root\[data-theme="dark"\] \{[^}]*--visa:\s*(#[0-9a-fA-F]{6})/,
    );
    expect(dark, "--visa in the forced-dark block").not.toBeNull();
    expect(swift).toEqual([cssHex("visa"), (dark as RegExpMatchArray)[1].toUpperCase()]);
  });

  it("keeps info out of the palette's taken hues", () => {
    // The reason it is a new token: every blue here already means something.
    // If somebody later "tidies up" by pointing info at one of them, the
    // charge starts looking like a category or like a person.
    const info = cssHex("info");
    expect(info).not.toBe("#2A6FDB"); // transport, and Cristian's avatar
    expect(info).not.toBe("#0E8F8F"); // the services category
  });
});
