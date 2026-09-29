import { getFirebaseClient } from "./client";

/**
 * Where a listener that FAILED is announced.
 *
 * Every live list already set `failed: true` on an error, and no screen ever
 * read it: a refused read drew exactly what an empty one draws — a period
 * with its whole budget unspent, a register with nothing in it. Rather than
 * teach a dozen screens to check a flag, the failure is announced here and
 * the app's error dialog listens (AppErrorProvider), so the next listener
 * inherits the report without anyone remembering to wire it.
 *
 * Lives in lib and is subscribed to from components, not the other way
 * round: nothing under lib imports a component.
 */
let subscriber: ((error: unknown) => void) | null = null;

export function onReadFailure(fn: ((error: unknown) => void) | null): void {
  subscriber = fn;
}

export function readFailed(label: string, error: unknown): void {
  console.error(`[gastos] ${label} listener`, error);
  // Signing out tears the listeners down, and the server may refuse the ones
  // still open for the instant in between. That is the app leaving, not data
  // missing, so it is not put in front of anybody.
  if (getFirebaseClient()?.auth.currentUser == null) return;
  subscriber?.(error);
}
