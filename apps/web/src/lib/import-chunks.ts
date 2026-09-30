/**
 * Write `rows` in chunks, and say how many landed.
 *
 * A batch is atomic; an import of several is not. When a later chunk fails
 * the earlier ones are already in Firestore, and "it failed" without the
 * count is what made a retry of the same file import them a second time.
 * Stops at the first failure — nothing after it was attempted.
 */
export async function commitInChunks<T>(
  rows: readonly T[],
  size: number,
  commit: (chunk: readonly T[]) => Promise<void>,
): Promise<{ written: number; error: unknown }> {
  let written = 0;
  try {
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      await commit(chunk);
      written += chunk.length;
    }
  } catch (error) {
    return { written, error };
  }
  return { written, error: null };
}
