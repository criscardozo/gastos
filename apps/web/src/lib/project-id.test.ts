import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The Firebase project id is `qcris-gastos-diarios`, everywhere, forever.
 *
 * It is permanent: renaming the app to Gastos renamed the display name, the
 * repo, the bundle ids and the Vercel project, and could not rename this. The
 * rebranding pass shortened it anyway in `scripts/backup.mjs` and
 * `scripts/restore.mjs`, and nothing noticed for two Thursdays — until the
 * weekly job failed with `Permission denied on resource project qcris-gastos`,
 * a project that does not exist.
 *
 * Two Thursdays is the part worth guarding against. A backup that stops
 * running is not like a test that stops passing: it fails somewhere nobody
 * looks, and what it protects is the only copy of the household's ledger.
 *
 * So this is a NEGATIVE guard, not a positive one. Asserting that the right id
 * appears somewhere would have passed the whole time — nine other files still
 * had it. What went wrong was the WRONG id appearing, so that is what is
 * checked.
 */
describe("the Firebase project id", () => {
  const ROOT = join(import.meta.dirname, "../../../..");
  const CORRECT = "qcris-gastos-diarios";

  /** Every tracked file's contents, via git so node_modules cannot leak in. */
  function grep(pattern: string): string[] {
    try {
      return execFileSync("git", ["grep", "-nI", "-e", pattern], {
        cwd: ROOT,
        encoding: "utf8",
      })
        .split("\n")
        .filter((line) => line !== "");
    } catch {
      // git grep exits 1 when nothing matches, which is the good case here.
      return [];
    }
  }

  it("can see the repo at all", () => {
    // Without this the two assertions below pass on an empty search — the
    // exact failure they exist to catch, one level up.
    expect(grep(CORRECT).length).toBeGreaterThan(8);
  });

  it("is never written without the -diarios", () => {
    const wrong = grep("qcris-gastos").filter(
      (line) => !line.includes(CORRECT) && !line.includes("project-id.test.ts"),
    );
    expect(wrong, `the project id is ${CORRECT}:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("is what the backup and restore scripts use", () => {
    // Named on purpose rather than left to the sweep above: these two are the
    // ones that broke, and they are the ones nobody runs by hand.
    for (const script of ["scripts/backup.mjs", "scripts/restore.mjs"]) {
      const hit = grep(`const PROJECT_ID = "${CORRECT}"`).filter((l) =>
        l.startsWith(script),
      );
      expect(hit, `${script} must set PROJECT_ID to ${CORRECT}`).toHaveLength(1);
    }
  });
});
