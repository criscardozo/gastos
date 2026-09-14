// May an expense be added right now?
//
// "Todavía no arrancar" closes the start-period screen without answering it,
// so somebody can look at last period's numbers before deciding. The period
// stays materialized and unconfirmed — which is the state it was already in,
// nothing is written — and that is precisely why entry has to be refused
// while it lasts.
//
// Without the refusal this is the bug the screen was made non-dismissable to
// fix, wearing a different hat: an expense filed into a period nobody started
// counts against a budget nobody chose, and the screen that would have asked
// is gone for the session. The "not yet" is only honest if the app also says
// "then not yet" when you try to spend.
//
// WHAT IT DOES NOT KEY ON, and this is the whole point: "the period is
// unconfirmed". A freshly onboarded household is in exactly that state — the
// first period is materialized lazily and the prompt is suppressed by the
// per-device ack, not by a confirmation — so a rule reading `confirmed` locks
// every new household out of its first expense. Five e2e tests said so within
// a minute of trying it.
//
// The block is a consequence of a DECISION somebody took in this session, so
// the decision is what it reads.

export interface PeriodGateState {
  /** The period containing today, or null when none is materialized. */
  currentPeriod: { startDate: string; confirmed: boolean } | null;
  /** The period start someone pressed "Todavía no arrancar" on, this visit. */
  deferredStart: string | null;
}

/**
 * Somebody chose to look without starting the period under way.
 *
 * `confirmed` matters and was missing at first: answering the screen does not
 * clear the deferral — it is in-memory state nobody thought to reset — so the
 * block survived the answer and the expense was still refused after starting
 * the period. You cannot be deferring something that has started, so the rule
 * says exactly that rather than relying on somebody remembering to clear it.
 * An e2e caught it in the run after the button first worked.
 */
export function periodDeferred(state: PeriodGateState): boolean {
  return (
    state.currentPeriod !== null &&
    !state.currentPeriod.confirmed &&
    state.deferredStart === state.currentPeriod.startDate
  );
}

export function canAddExpense(state: PeriodGateState): boolean {
  return !periodDeferred(state);
}
