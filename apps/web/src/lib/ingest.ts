// Whether the Gmail ingestion has stopped running.
//
// Its 15-minute Apps Script trigger can stop without a word — Google disables
// a trigger that keeps failing, an authorisation lapses — and from then on no
// charge arrives and the bank panel simply looks quiet. The ingestion stamps
// households/{id}/ingestStatus/latest at the end of every run it finishes, and
// this decides when that stamp is too old. Implemented twice (IngestHealth in
// Swift); both run shared/ingest-vectors.json.

export const INGEST_STALE_AFTER_MINUTES = 120;

export type IngestHealth =
  | { state: "unknown" }
  | { state: "fresh" | "stale"; hours: number };

/**
 * `ranAtMs` null — no heartbeat document — is "unknown", not "stale": it is an
 * ingestion older than the heartbeat, which says nothing about whether it
 * runs. A stamp in the future is fresh: it says the script ran.
 */
export function ingestHealth(ranAtMs: number | null, nowMs: number): IngestHealth {
  if (ranAtMs === null) return { state: "unknown" };
  const minutes = Math.max(0, Math.floor((nowMs - ranAtMs) / 60_000));
  return {
    state: minutes > INGEST_STALE_AFTER_MINUTES ? "stale" : "fresh",
    hours: Math.floor(minutes / 60),
  };
}
