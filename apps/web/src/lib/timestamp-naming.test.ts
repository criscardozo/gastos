import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every timestamp field is named `*At`, because the restore depends on it.
 *
 * `scripts/backup.mjs` flattens Timestamps to ISO strings — the dump is JSON
 * and JSON has no such type — and `scripts/restore.mjs` turns them back using
 * TWO signals: the key ends in `At`, and the value is a strict ISO instant. A
 * timestamp field named anything else survives the round trip as a STRING.
 *
 * That failure is invisible from both ends. The document restores, every value
 * reads back the same, and a dump taken afterwards serialises the string to
 * the same characters — so comparing dump against dump says identical while
 * the audit fields have quietly changed type. Queries and rules that treat
 * them as timestamps are what break, later, somewhere else. The Stock session
 * hit exactly this in its own round trip and could not see it until it tagged
 * the type in the dump.
 *
 * Measured today across a real production dump: 21 timestamp fields, all
 * ending in `At`, and zero ISO instants under any other name. So the
 * convention holds — and nothing was enforcing it, which is what this is for.
 */
describe("the timestamp naming the restore relies on", () => {
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
      `restore.mjs turns a dumped ISO string back into a Timestamp only when ` +
        `the key ends in "At". These would come back as strings:\n  ${wrong.join("\n  ")}`,
    ).toEqual([]);
  });
});
