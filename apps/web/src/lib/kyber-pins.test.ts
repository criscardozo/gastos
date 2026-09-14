import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * This repo points at kyber TWICE, and the two are different things.
 *
 * The submodule gitlink decides which SCRIPTS run. A `uses:` in a workflow
 * decides which WORKFLOW runs, and GitHub resolves that from the repository
 * rather than from the checked-out submodule — so moving one and forgetting the
 * other leaves a workflow from one commit driving scripts from another, with
 * nothing in the run's output saying so. The backup is the job that has it, and
 * it is the one nobody watches: it runs on Thursdays and protects the only copy
 * of the household's ledger.
 *
 * The check itself is kyber's (`check-kyber-pins.mjs`) because both consumers
 * have the same two pins. This is the part that makes it RUN: a script nobody
 * invokes is a comment. Here rather than as a CI step so it also fails on the
 * machine where the mistake is made, before the push.
 */
describe("the two pins at kyber", () => {
  const ROOT = join(import.meta.dirname, "../../../..");

  it("agree, and the checker found some to compare", () => {
    let output: string;
    try {
      output = execFileSync("node", ["kyber/scripts/check-kyber-pins.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
      });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      throw new Error(`${e.stdout ?? ""}${e.stderr ?? ""}`.trim());
    }

    // The script reports what it compared rather than only staying silent, so
    // this can tell "the pins agree" apart from "no pin was found" — a regex
    // that stops matching a `uses:` line would otherwise pass as agreement.
    expect(output, "the checker compared no pins at all").toMatch(/[1-9]\d* kyber pin/);
  });
});
