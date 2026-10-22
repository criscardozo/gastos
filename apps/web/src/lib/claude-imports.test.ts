import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The working rules in `docs/reglas/` reach an agent only through CLAUDE.md's
 * `@path` imports, and Claude Code resolves those silently: a path that does
 * not exist is simply not imported — no warning, no error — so an agent would
 * run without the rules and have no way to tell. Nothing else notices.
 */
describe("the rules CLAUDE.md imports", () => {
  const ROOT = join(import.meta.dirname, "../../../..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("all resolve", () => {
    const imports = [...read("CLAUDE.md").matchAll(/^@(\S+)$/gm)].map((m) => m[1]);
    // Without a floor, a CLAUDE.md that lost every import passes on nothing.
    expect(imports.length, "CLAUDE.md imports no rules").toBeGreaterThan(3);
    const missing = imports.filter((path) => !existsSync(join(ROOT, path)));
    expect(missing, `CLAUDE.md imports files that do not exist:\n${missing.join("\n")}`)
      .toEqual([]);
  });

  it("are linked from reglas.md, and every link resolves", () => {
    // Links in reglas.md are the same hazard with a different renderer: a dead
    // relative link is a 404 nobody clicks until they need the rule.
    const links = [...read("docs/reglas.md").matchAll(/\]\((reglas\/[^)#]+)/g)].map(
      (m) => m[1],
    );
    expect(links.length, "reglas.md points at nothing in docs/reglas/").toBeGreaterThan(3);
    const dead = links.filter((rel) => !existsSync(join(ROOT, "docs", rel)));
    expect(dead, `docs/reglas.md links to files that do not exist:\n${dead.join("\n")}`)
      .toEqual([]);
  });
});
