import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every text colour clears WCAG AA (4.5:1) on the surfaces it is drawn on, in
 * both themes.
 *
 * Measured on 2026-09-25 before this existed: the tertiary grey — 108 uses on
 * iOS, 156 on the web — was 2.19:1 on the page, the secondary 3.48:1, the amber
 * 3.40:1 and the accent used as text 3.60:1. None of that showed in any test,
 * because nothing computed it; the palette LOOKED fine. The values now come
 * from tokens.json (which generates both platforms) and the surfaces from it
 * plus the tints globals.css composites over the card, so a token edit that
 * breaks legibility fails here on both clients at once.
 *
 * The pairs are where each colour actually sits: greys on the page, the card
 * and the chip fill; a state colour on the page, the card and its own tint.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const tokens = JSON.parse(readFileSync(join(ROOT, "design-system/tokens.json"), "utf8")).color;
const CSS = readFileSync(join(ROOT, "apps/web/src/app/globals.css"), "utf8");

type Theme = "light" | "dark";
const hex = (group: string, name: string, theme: Theme): string => {
  const v = tokens[group][name].$value[theme];
  return typeof v === "string" ? v : v.base;
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg: string, alpha: number, bg: string) =>
  "#" +
  rgb(fg)
    .map((v, i) => Math.round(v * alpha + rgb(bg)[i] * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("");

/** A tint's rgba from globals.css: the light block, or the first dark block. */
function tint(name: string, theme: Theme): string {
  const light = CSS.slice(0, CSS.indexOf("@media (prefers-color-scheme: dark)"));
  const dark = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: dark)"));
  const block = theme === "light" ? light : dark;
  const m = new RegExp(`--${name}:\\s*rgba\\((\\d+), (\\d+), (\\d+), ([\\d.]+)\\)`).exec(block)
    ?? new RegExp(`--${name}:\\s*rgba\\((\\d+), (\\d+), (\\d+), ([\\d.]+)\\)`).exec(light);
  expect(m, `--${name} in globals.css`).not.toBeNull();
  const [, r, g, b, a] = m as RegExpExecArray;
  const fg = "#" + [r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  const base = name === "fill" ? hex("core", "bg", theme) : hex("core", "surface", theme);
  return over(fg, Number(a), base);
}

const PAIRS: [string, string, string[]][] = [
  ["core", "ink", ["bg", "surface", "fill"]],
  ["core", "ink-secondary", ["bg", "surface", "fill"]],
  ["core", "ink-tertiary", ["bg", "surface", "fill"]],
  ["core", "accent-strong", ["bg", "surface", "accent-soft"]],
  ["state", "good-text", ["bg", "surface", "good-bg"]],
  ["state", "warn-text", ["bg", "surface", "warn-bg"]],
  ["state", "over-text", ["bg", "surface", "over-bg"]],
  ["state", "info-text", ["bg", "surface", "info-bg"]],
];

describe("text colours against their surfaces", () => {
  it("clears 4.5:1 everywhere it is drawn, in both themes", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const theme of ["light", "dark"] as Theme[]) {
      for (const [group, name, surfaces] of PAIRS) {
        for (const s of surfaces) {
          const bg = s === "bg" || s === "surface" ? hex("core", s, theme) : tint(s, theme);
          const r = ratio(hex(group, name, theme), bg);
          checked++;
          if (r < 4.5) failures.push(`${theme}: ${name} on ${s} is ${r.toFixed(2)}:1`);
        }
      }
    }
    expect(checked).toBe(48);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps the greys in order: ink, then secondary, then tertiary", () => {
    // Legibility alone would allow the three to collapse into one grey; the
    // hierarchy is the reason there are three.
    for (const theme of ["light", "dark"] as Theme[]) {
      const bg = hex("core", "bg", theme);
      const [a, b, c] = ["ink", "ink-secondary", "ink-tertiary"].map((n) => ratio(hex("core", n, theme), bg));
      expect(a, theme).toBeGreaterThan(b + 1);
      expect(b, theme).toBeGreaterThan(c + 0.5);
    }
  });
});
