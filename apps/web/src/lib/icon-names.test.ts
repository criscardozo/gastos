import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import seed from "../../../../shared/categories.json";
import { CATEGORY_ICONS } from "./categories";

/**
 * Every icon the app names exists in the inline set.
 *
 * A name missing from ICON_PATHS draws an EMPTY square — and in production
 * not even the console says so. Three went in that way on 2026-10-02
 * (archive, fact_check, expand_less) with every test green.
 *
 * What this sees: string literals given to `name` on <Icon> and <IconButton>
 * (ternaries included), the seed categories' icons and the custom-category
 * picker. What it cannot see: a name that arrives some other way — a
 * variable, a prop under another name. A sweep of the source has that blind
 * spot by construction; this closes the forms that exist today, not every
 * form there could be.
 */
const WEB = join(import.meta.dirname, "../..");

function sourceFiles(): string[] {
  // Tracked and untracked-but-not-ignored: the file just written is where a
  // new icon name appears, and an ignored build dir must stay out.
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src"], {
    cwd: WEB,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
}

function iconSet(): Set<string> {
  const text = readFileSync(join(WEB, "src/components/ui/icon.tsx"), "utf8");
  return new Set([...text.matchAll(/^ {2}"?([a-z_0-9]+)"?:/gm)].map((m) => m[1]));
}

function namedInSource(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of sourceFiles()) {
    const text = readFileSync(join(WEB, file), "utf8");
    for (const tag of text.matchAll(/<(?:Icon|IconButton)\b([\s\S]*?)\/?>/g)) {
      const attr = tag[1].match(/\bname=(?:"([a-z_0-9]+)"|\{([^}]*)\})/);
      if (attr === null) continue;
      // In an expression, only the literals that can BE the result: the
      // whole of it, or a branch after `?` or `:`. A literal compared in the
      // condition (`sortKey === "category" ? …`) is not an icon.
      const literals =
        attr[1] !== undefined
          ? [attr[1]]
          : [...attr[2].matchAll(/(?:^\s*|[?:]\s*)"([a-z_0-9]+)"/g)].map((m) => m[1]);
      for (const name of literals) out.set(name, file);
    }
  }
  return out;
}

describe("icon names", () => {
  it("every icon the app names is drawn", () => {
    const set = iconSet();
    const named = namedInSource();
    // Anti-empty: the sweep found something to check.
    expect(named.size).toBeGreaterThan(30);
    const wanted = new Map(named);
    for (const c of seed.categories) wanted.set(c.icon.material, "shared/categories.json");
    for (const name of CATEGORY_ICONS) wanted.set(name, "CATEGORY_ICONS");
    const missing = [...wanted].filter(([name]) => !set.has(name)).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
  });
});
