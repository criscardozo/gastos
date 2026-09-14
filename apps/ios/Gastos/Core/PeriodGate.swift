import Foundation

/// May an expense be added right now?
///
/// "Todavía no arrancar" closes the start-period screen without answering it,
/// so somebody can look at last period's numbers before deciding. The screen
/// is otherwise not dismissable on purpose — swiping it away used to accept
/// the default budget in silence — and that is exactly why the deferral has to
/// cost something: an expense filed into a period nobody started counts
/// against a budget nobody chose, with the screen that would have asked
/// already gone for the session.
///
/// The TypeScript twin is apps/web/src/lib/period-gate.ts. Two rules that must
/// agree, because the phone and the web share one Firestore and one household.
enum PeriodGate {
    /// Somebody chose to look without starting the period under way.
    ///
    /// Reads the DECISION, not the data. "The period is unconfirmed" is the
    /// tempting rule and it is wrong: a freshly onboarded household is in
    /// exactly that state — the first period is materialized lazily and the
    /// prompt is suppressed per device, not by a confirmation — so keying on
    /// it locks a new household out of its first expense. Five web e2e tests
    /// said so within a minute of trying.
    ///
    /// `confirmed` is here for the other direction: answering the screen does
    /// not clear the in-memory deferral, so without this the block outlived
    /// the decision and the expense was still refused after the period
    /// started.
    static func deferred(
        currentPeriodStart: String?,
        currentPeriodConfirmed: Bool,
        deferredStart: String?
    ) -> Bool {
        guard let currentPeriodStart, !currentPeriodConfirmed else { return false }
        return deferredStart == currentPeriodStart
    }

    static func canAddExpense(
        currentPeriodStart: String?,
        currentPeriodConfirmed: Bool,
        deferredStart: String?
    ) -> Bool {
        !deferred(
            currentPeriodStart: currentPeriodStart,
            currentPeriodConfirmed: currentPeriodConfirmed,
            deferredStart: deferredStart
        )
    }
}
