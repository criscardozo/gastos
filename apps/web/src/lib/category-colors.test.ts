import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every seed category has its colour in every theme block of globals.css.
 *
 * `categoryColor()` answers `var(--cat-<id>)` for a seed category, and CSS does
 * not complain about a variable nobody defined: the icon silently inherits the
 * text colour and `color-mix()` over it turns the circle transparent. That is
 * how every "Servicios" expense on the web drew as a bare black glyph, while
 * iOS — reading the same categories.json — drew it teal. The stylesheet even
 * had a comment naming `--cat-services` as teal. Nothing checked, because the
 * page renders fine; it just renders the wrong thing.
 *
 * The ids come FROM categories.json rather than being written here, so a
 * category added there fails this until the stylesheet has it too.
 */

const ROOT = join(import.meta.dirname, "../../../..");
const CSS = readFileSync(join(ROOT, "apps/web/src/app/globals.css"), "utf8");
const { categories } = JSON.parse(
  readFileSync(join(ROOT, "shared/categories.json"), "utf8"),
) as {
  categories: { id: string; color: { light: string; dark: string } }[];
};

/**
 * The body of the rule that opens with `opener`, braces balanced.
 *
 * Comments are skipped while counting: this stylesheet explains itself at
 * length, and a brace inside that prose would end the block early without
 * anything saying so — the failure this repo has already had three times.
 */
function block(opener: string): string {
  const start = CSS.indexOf(opener);
  expect(start, `"${opener}" in globals.css`).toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS.startsWith("/*", i)) {
      i = CSS.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (CSS[i] === "{") depth++;
    if (CSS[i] === "}" && --depth === 0) return CSS.slice(open + 1, i);
  }
  throw new Error(`unbalanced block after "${opener}"`);
}

/** The value of `--name:` declared directly in `body`, or null. */
function declared(body: string, name: string): string | null {
  const match = body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  return match === null ? null : match[1].toUpperCase();
}

// Light, the system-dark override, and the forced-dark override. All three,
// because a theme that falls back to another block's value would not be wrong
// in the light theme and would be in the dark one.
const THEMES = [
  { name: "light", opener: ":root {", tone: "light" },
  { name: "system dark", opener: ':root:not([data-theme="light"]) {', tone: "dark" },
  { name: "forced dark", opener: ':root[data-theme="dark"] {', tone: "dark" },
] as const;

describe("seed category colours in the stylesheet", () => {
  it("has categories to check", () => {
    // Anti-empty: a renamed file or key must not turn every assertion below
    // into a loop over nothing.
    expect(categories.length).toBeGreaterThan(5);
  });

  it("defines --cat-<id> in every theme, with categories.json's colour", () => {
    // One test that walks the whole list, so an empty list cannot pass by
    // producing no tests — and it names every miss, not only the first.
    const problems: string[] = [];
    for (const theme of THEMES) {
      const body = block(theme.opener);
      for (const category of categories) {
        const found = declared(body, `cat-${category.id}`);
        const expected = category.color[theme.tone].toUpperCase();
        if (found === null) problems.push(`${theme.name}: --cat-${category.id} is missing`);
        else if (found !== expected)
          problems.push(`${theme.name}: --cat-${category.id} is ${found}, categories.json says ${expected}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
