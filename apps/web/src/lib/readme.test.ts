import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The README's own references, which nothing else checks.
 *
 * Markdown is not executed, so a link that stops resolving reads exactly like
 * one that does until somebody clicks it — and the people most likely to click
 * are the ones who arrived today and have the least idea what was meant.
 *
 * The sibling project wrote this one first and was right that it was worth
 * having; the argument against it here had confused two things. The STYLE
 * cannot be guarded and should not be: getting it wrong costs a correction.
 * A banner that 404s and a link into a file somebody moved are not style.
 *
 * Each sweep asserts it FOUND something before asserting the results are
 * clean, and they are separate assertions rather than one total. A regex that
 * stops matching returns an empty list, and an empty list passes a "nothing is
 * broken" check while proving nothing; a single total would also go red the day
 * a link is legitimately removed.
 */
describe("the README's references", () => {
  const ROOT = join(import.meta.dirname, "../../../..");
  const README = readFileSync(join(ROOT, "README.md"), "utf8");

  /** Markdown links pointing at the repo rather than out at the web. */
  const links = [...README.matchAll(/\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((p) => !/^(https?:|mailto:|#)/.test(p))
    .map((p) => p.split("#")[0]);

  /** `src` of every HTML image — the banner is one of these, not markdown. */
  const images = [...README.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);

  it("links to files that are there", () => {
    expect(links.length, "found no local links at all — the sweep is broken").toBeGreaterThan(
      2,
    );
    const dead = links.filter((p) => !existsSync(join(ROOT, p)));
    expect(dead, `the README points at files that do not exist:\n  ${dead.join("\n  ")}`)
      .toEqual([]);
  });

  it("shows images that are in the repo, by relative path", () => {
    expect(images.length, "found no images at all — the sweep is broken").toBeGreaterThan(
      0,
    );

    // Checked before existence, and separately, because an absolute URL fails
    // the existence check too — by accident, for having an absurd path. The
    // sibling project found that one by mutating: the guard caught it and said
    // the wrong thing. A README whose art lives on someone else's host breaks
    // when that host does, and nothing here would know.
    const remote = images.filter((src) => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(src));
    expect(
      remote,
      `README images must be committed files, not URLs:\n  ${remote.join("\n  ")}`,
    ).toEqual([]);

    const missing = images.filter((src) => !existsSync(join(ROOT, src)));
    expect(missing, `the README shows images that are not here:\n  ${missing.join("\n  ")}`)
      .toEqual([]);
  });

  it("opens with the generated banner, and says what it is", () => {
    // The banner IS the title — there is no `# Gastos` heading behind it — so
    // without alt text the page opens with nothing for a reader who cannot see
    // it, and nothing for GitHub to show while the image loads.
    const banner = /<img[^>]*\ssrc="(docs\/assets\/banner\.[a-z]+)"[^>]*>/.exec(README);
    expect(banner, "the README does not open with docs/assets/banner.*").not.toBeNull();
    expect(banner![0], "the banner needs alt text: it stands in for the title").toMatch(
      /\salt="[^"]+"/,
    );

    // The .svg is committed beside the .png because it is the generator's real
    // output; the .png is what GitHub renders. Losing either leaves the other
    // unexplained.
    for (const f of ["docs/assets/banner.png", "docs/assets/banner.svg"]) {
      expect(existsSync(join(ROOT, f)), `${f} is missing`).toBe(true);
      expect(statSync(join(ROOT, f)).size, `${f} is empty`).toBeGreaterThan(1000);
    }
  });
});
