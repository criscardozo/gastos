/**
 * Whether a manual "run now" request counts as current.
 *
 * Plain ES5-ish JavaScript, like parse.js and config.js: the same source is
 * pasted into the Apps Script project and imported by the vitest suite here.
 *
 * The apps cannot reach the mailbox, so the button stamps
 * `households/{id}.ingestRequestedAt` — a write only a member can make, with
 * the server's clock, enforced by the security rules — and then pings the
 * script's public URL. This decides whether that stamp is recent enough to act
 * on, which is what keeps a poke at the URL from doing any work.
 *
 * The window is deliberately short. It only has to cover the round trip between
 * the write and the ping; anything longer would let an old stamp turn a stray
 * request into a real run.
 */

var REQUEST_WINDOW_MS = 2 * 60 * 1000;

/**
 * `requestedAt` is null when the household has never been stamped.
 *
 * A stamp in the FUTURE is refused rather than trusted: the rules require the
 * server's clock, so a future one means something is wrong, and treating it as
 * fresh would make the window permanent.
 */
function isRequestFresh(requestedAt, now) {
  if (requestedAt === null || requestedAt === undefined) return false;
  var age = now.getTime() - requestedAt.getTime();
  return age >= 0 && age <= REQUEST_WINDOW_MS;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    REQUEST_WINDOW_MS: REQUEST_WINDOW_MS,
    isRequestFresh: isRequestFresh,
  };
}
