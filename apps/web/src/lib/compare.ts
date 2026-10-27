/**
 * Orders two strings by UTF-16 code unit, the way Swift's `<` orders the ASCII
 * ids and folded patterns it is used on.
 *
 * Not `localeCompare`: that collates — "a1" before "B1", "_" before digits —
 * while Swift puts "B1" first. A tie-break whose job is to make both clients
 * pick the same candidate cannot use an order only one of them has. Firestore
 * ids mix cases, so this was a real disagreement, not a theoretical one.
 */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
