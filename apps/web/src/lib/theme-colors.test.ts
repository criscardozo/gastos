import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every Tailwind colour utility the web uses names a colour the theme defines.
 *
 * globals.css starts its @theme with `--color-*: initial`, which removes
 * Tailwind's whole default palette so only the design tokens exist. A class
 * that names a default colour after that — `bg-black/40` — generates NOTHING,
 * silently: no build error, no lint, the element just has no background. That
 * is how every modal on the web shipped with an invisible backdrop from the
 * first one (6/8) until 25/9: twelve files asking for a scrim that did not
 * exist. Measured in the browser: the class was there, the computed
 * background was rgba(0, 0, 0, 0).
 *
 * Checks the default palette's names only — `text-sm` or `border-2` are not
 * colours and are none of this test's business.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const CSS = readFileSync(join(ROOT, "apps/web/src/app/globals.css"), "utf8");

const DEFAULT_PALETTE = [
  "black", "white", "transparent", "current", "slate", "gray", "zinc",
  "neutral", "stone", "red", "orange", "amber", "yellow", "lime", "green",
  "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple",
  "fuchsia", "pink", "rose",
];

const theme = CSS.slice(CSS.indexOf("@theme"));
const defined = new Set(
  [...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]),
);

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "apps/web/src"],
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"));

const PREFIX = "(?:bg|text|border|ring|fill|stroke|outline|divide|from|via|to|placeholder|caret|decoration|shadow|accent)";
const USE = new RegExp(
  `(?<![\\w-])${PREFIX}-(${DEFAULT_PALETTE.join("|")})(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`,
  "g",
);

describe("colour utilities against the theme", () => {
  it("has a theme and files to read", () => {
    expect(defined.size).toBeGreaterThan(20);
    expect(files.length).toBeGreaterThan(50);
  });

  it("never names a default colour the theme removed", () => {
    const missing = new Map<string, string[]>();
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const m of text.matchAll(USE)) {
        if (defined.has(m[1])) continue;
        const at = missing.get(m[1]) ?? [];
        at.push(f);
        missing.set(m[1], at);
      }
    }
    const report = [...missing].map(
      ([name, at]) => `--color-${name} is not in @theme, used ${at.length}× (${[...new Set(at)].slice(0, 3).join(", ")}…)`,
    );
    expect(report, report.join("\n")).toEqual([]);
  });
});

/**
 * A disabled coral button goes grey through `primary-disabled`, never by
 * dimming itself.
 *
 * Twenty buttons each said `disabled:opacity-NN`, with four different NNs for
 * one decision: a washed-out coral with a white label, still reading as the
 * button to press. The look lives once, in globals.css; this fails the next
 * class string that pairs the coral fill with an opacity instead of the name.
 * Known gap, left open: a coral button with no disabled styling at all passes.
 */
describe("disabled primary buttons", () => {
  const CLASS_STRING = /"[^"\n]*"|`[^`]*`/g;
  const CORAL = /(?<![\w-])bg-accent(?![\w-])/;

  it("has the utility to point at", () => {
    expect(CSS).toMatch(/@utility primary-disabled\s*\{/);
  });

  it("never dims a coral button with opacity", () => {
    const offenders: string[] = [];
    let coralStrings = 0;
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const m of text.matchAll(CLASS_STRING)) {
        if (!CORAL.test(m[0])) continue;
        coralStrings++;
        if (/disabled:opacity-/.test(m[0])) offenders.push(`${f}: ${m[0].slice(0, 90)}`);
      }
    }
    // Anti-empty: a sweep that found no coral classes at all checked nothing.
    expect(coralStrings).toBeGreaterThan(10);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
