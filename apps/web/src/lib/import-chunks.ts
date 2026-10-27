/**
 * Write `rows` in chunks, and say how many landed.
 *
 * A batch is atomic; an import of several is not. When a later chunk fails
 * the earlier ones are already in Firestore, and "it failed" without the
 * count is what made a retry of the same file import them a second time.
 * Stops at the first failure — nothing after it was attempted.
 *
 * `settleWithinMs`: how long to wait for the server to confirm a chunk. A
 * commit only resolves on the server's word, so offline it never did and the
 * import screen hung. By then the chunk is in the local cache and goes up with
 * the connection, so past the limit this stops waiting: it hands every
 * remaining chunk over unawaited and reports them as `queued`. A refusal that
 * arrives later is logged, not shown — the rows were validated against the
 * same shape the rules check.
 */
export async function commitInChunks<T>(
  rows: readonly T[],
  size: number,
  commit: (chunk: readonly T[]) => Promise<void>,
  settleWithinMs?: number,
): Promise<{ written: number; error: unknown; queued: number }> {
  let written = 0;
  try {
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      const committing = commit(chunk);
      if (settleWithinMs === undefined) {
        await committing;
      } else if (!(await settlesWithin(committing, settleWithinMs))) {
        committing.catch(logLate);
        for (let j = i + size; j < rows.length; j += size) {
          commit(rows.slice(j, j + size)).catch(logLate);
        }
        return { written, error: null, queued: rows.length - written };
      }
      written += chunk.length;
    }
  } catch (error) {
    return { written, error, queued: 0 };
  }
  return { written, error: null, queued: 0 };
}

/** True when `promise` resolves in time; rethrows if it rejects in time. */
async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true as const), late]);
  } finally {
    clearTimeout(timer);
  }
}

function logLate(error: unknown) {
  console.error("[gastos] import, after going on without the server", error);
}
