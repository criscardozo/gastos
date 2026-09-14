import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every timestamp field is named `*At`, because the restore depends on it.
 *
 * Dumps written BEFORE 14/9/2026 flattened Timestamps to ISO strings — JSON
 * has no such type — and the only way back was TWO signals: the key ends in
 * `At`, and the value is a strict ISO instant. A timestamp field named
 * anything else survived the round trip as a STRING.
 *
 * `kyber/scripts/backup.mjs` tags the type now (`{"$timestamp": "..."}`), so
 * new dumps do not depend on this convention at all. This guard did not become
 * decorative, it changed what it protects: every dump taken between 17/7 and
 * 14/9 is still read back through the naming rule, and those are the only
 * copies of the ledger for that period. Renaming a field in the schema would
 * not break a restore of yesterday's dump — it would break a restore of
 * August's, which is the one nobody would test.
 *
 * That failure is invisible from both ends. The document restores, every value
 * reads back the same, and a dump taken afterwards serialises the string to
 * the same characters — so comparing dump against dump says identical while
 * the audit fields have quietly changed type. Queries and rules that treat
 * them as timestamps are what break, later, somewhere else. The Stock session
 * hit exactly this in its own round trip and could not see it until it tagged
 * the type in the dump.
 *
 * Measured across the production dump of 14/9/2026: 238 instants, every one
 * under a key ending in `At`, and zero under any other name — so the legacy
 * path covers all of it, and nothing but this was enforcing that.
 */
describe("the timestamp naming the legacy restore relies on", () => {
  const SCHEMA = readFileSync(
    join(import.meta.dirname, "../../../../shared/schema.md"),
    "utf8",
  );

  /** Field names from every schema row whose type column says `timestamp`. */
  function timestampFields(): string[] {
    const names: string[] = [];
    for (const line of SCHEMA.split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim());
      // | name | type | notes |  →  cells[1] is the name, cells[2] the type.
      if (cells.length < 3) continue;
      if (!/^timestamp\b/.test(cells[2].replace(/\\/g, ""))) continue;
      for (const match of cells[1].matchAll(/`([^`]+)`/g)) names.push(match[1]);
    }
    return names;
  }

  it("finds the schema's timestamp rows at all", () => {
    // An empty list would make the assertion below pass over nothing — the
    // shape that let a deleted guard sit green in this repo for a commit.
    expect(timestampFields().length).toBeGreaterThan(10);
  });

  it("names every one of them *At", () => {
    const wrong = timestampFields().filter((name) => !name.endsWith("At"));
    expect(
      wrong,
      `a pre-14/9 dump turns an ISO string back into a Timestamp only when ` +
        `the key ends in "At". These would come back as strings:\n  ${wrong.join("\n  ")}`,
    ).toEqual([]);
  });
});
