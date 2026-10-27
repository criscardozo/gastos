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
    expect(result).toEqual({ written: 900, error: null, queued: 0 });
  });

  it("says how many landed before a chunk failed, and stops there", async () => {
    let calls = 0;
    const boom = new Error("refused");
    const result = await commitInChunks(rows, 400, async () => {
      calls += 1;
      if (calls === 2) throw boom;
    });
    expect(result).toEqual({ written: 400, error: boom, queued: 0 });
    expect(calls).toBe(2);
  });

  it("a first chunk failing wrote nothing", async () => {
    const result = await commitInChunks(rows, 400, async () => {
      throw new Error("refused");
    });
    expect(result.written).toBe(0);
  });

  // Offline, a commit only resolves once the server confirms, so the screen
  // sat on "Importando…" for good. The writes are already in the local cache
  // and will go up with the connection; what was missing was letting go.
  it("lets go of a commit the server does not confirm, and queues the rest", async () => {
    const started: number[] = [];
    const never = new Promise<void>(() => {});
    const result = await commitInChunks(
      rows,
      400,
      (chunk) => {
        started.push(chunk.length);
        return started.length === 1 ? Promise.resolve() : never;
      },
      20,
    );
    expect(result).toEqual({ written: 400, error: null, queued: 500 });
    // Every chunk was handed to Firestore — the last one without waiting.
    expect(started).toEqual([400, 400, 100]);
  });

  it("a slow chunk that does answer in time is just written", async () => {
    const result = await commitInChunks(
      rows,
      400,
      () => new Promise<void>((resolve) => setTimeout(resolve, 5)),
      200,
    );
    expect(result).toEqual({ written: 900, error: null, queued: 0 });
  });
});
