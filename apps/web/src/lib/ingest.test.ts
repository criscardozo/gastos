import { describe, expect, it } from "vitest";

import vectors from "../../../../shared/ingest-vectors.json";
import { INGEST_STALE_AFTER_MINUTES, ingestHealth } from "./ingest";

// Twice implemented — here and IngestHealth.swift — so both run this file.
describe("ingestHealth (shared vectors)", () => {
  it("has the limit and the cases the file declares", () => {
    expect(INGEST_STALE_AFTER_MINUTES).toBe(vectors.staleAfterMinutes);
    // Exact: the population is the file's own list, closed by construction.
    expect(vectors.cases.length).toBe(7);
  });

  it("answers every case", () => {
    for (const c of vectors.cases) {
      const result = ingestHealth(
        c.ranAt === null ? null : Date.parse(c.ranAt),
        Date.parse(c.now),
      );
      expect(result, c.name).toEqual(
        c.expected === "unknown"
          ? { state: "unknown" }
          : { state: c.expected, hours: c.hours },
      );
    }
  });
});
