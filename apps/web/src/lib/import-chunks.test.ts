import { describe, expect, it } from "vitest";

import { commitInChunks } from "./import-chunks";

// A CSV import writes in batches of 400, and a batch is atomic but the
// import is not: when the second batch failed the first was already in
// Firestore, and the screen said only "try again" — which, with the same
// file, imported those 400 a second time.
describe("commitInChunks", () => {
  const rows = Array.from({ length: 900 }, (_, i) => i);

  it("writes everything in chunks of the size given", async () => {
    const sizes: number[] = [];
    const result = await commitInChunks(rows, 400, async (chunk) => {
      sizes.push(chunk.length);
    });
    expect(sizes).toEqual([400, 400, 100]);
    expect(result).toEqual({ written: 900, error: null });
  });

  it("says how many landed before a chunk failed, and stops there", async () => {
    let calls = 0;
    const boom = new Error("refused");
    const result = await commitInChunks(rows, 400, async () => {
      calls += 1;
      if (calls === 2) throw boom;
    });
    expect(result).toEqual({ written: 400, error: boom });
    expect(calls).toBe(2);
  });

  it("a first chunk failing wrote nothing", async () => {
    const result = await commitInChunks(rows, 400, async () => {
      throw new Error("refused");
    });
    expect(result.written).toBe(0);
  });
});
