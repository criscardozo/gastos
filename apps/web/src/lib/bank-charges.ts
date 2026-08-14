// The 48-hour window a dismissed bank charge can be taken back in.
//
// Dismissing used to delete the document, which made "I discarded that by
// mistake" unrecoverable: the charge was gone from Firestore and the ingestion
// remembers the Gmail message id, so no future sweep would bring it back.
// Instead a dismissal stamps `dismissedAt` and the charge merely stops being
// pending — for 48 hours it can be restored, after which a client sweep deletes
// it for real.
//
// Matching a charge to an expense still deletes on the spot, and should:
// reconciling is not a mistake anyone needs to take back, and a resurrected
// charge would offer to verify an already-verified expense.
//
// Pure module: no Firebase, no React. `now` is always passed in, never read
// from the clock, so every case here is testable.
//
// The Swift twin is BankChargeInbox.swift. Unlike the period arithmetic and the
// bank matcher, this pair shares no JSON vectors: "is this stamp older than 48
// hours" has no calendar edge cases to disagree about — the only thing the two
// must agree on is the constant below.

/** How long a dismissed charge stays recoverable. */
export const DISMISS_WINDOW_HOURS = 48;

const DISMISS_WINDOW_MS = DISMISS_WINDOW_HOURS * 60 * 60 * 1000;

/** The only shape any of this needs — the rest of the charge is irrelevant. */
export interface Dismissable {
  dismissedAt: Date | null;
}

export function isPending(charge: Dismissable): boolean {
  return charge.dismissedAt === null;
}

/**
 * Past the window, so it should be deleted and must not be listed. Note this is
 * `>=`: a charge dismissed exactly 48 hours ago is out, which keeps "recoverable
 * for 48 hours" literally true.
 */
export function isExpired(charge: Dismissable, now: Date): boolean {
  if (charge.dismissedAt === null) return false;
  return now.getTime() - charge.dismissedAt.getTime() >= DISMISS_WINDOW_MS;
}

/** Dismissed and still inside the window. */
export function isRecoverable(charge: Dismissable, now: Date): boolean {
  return charge.dismissedAt !== null && !isExpired(charge, now);
}

export interface ChargePartition<T> {
  /** Never dismissed — the working list. */
  pending: T[];
  /** Dismissed within the window, newest dismissal first: the one most likely
   * to have been a slip is the one at the top. */
  dismissed: T[];
  /** Past the window. Nobody renders these; the sweep deletes them. */
  expired: T[];
}

export function partitionCharges<T extends Dismissable>(
  charges: T[],
  now: Date,
): ChargePartition<T> {
  const pending: T[] = [];
  const dismissed: T[] = [];
  const expired: T[] = [];

  for (const charge of charges) {
    if (charge.dismissedAt === null) pending.push(charge);
    else if (isExpired(charge, now)) expired.push(charge);
    else dismissed.push(charge);
  }

  dismissed.sort(
    (a, b) =>
      (b.dismissedAt?.getTime() ?? 0) - (a.dismissedAt?.getTime() ?? 0),
  );

  return { pending, dismissed, expired };
}
