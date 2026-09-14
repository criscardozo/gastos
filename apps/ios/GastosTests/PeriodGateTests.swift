import XCTest

/// The twin of apps/web/src/lib/period-gate.test.ts.
final class PeriodGateTests: XCTestCase {
    private func canAdd(start: String?, confirmed: Bool, deferred: String?) -> Bool {
        PeriodGate.canAddExpense(
            currentPeriodStart: start,
            currentPeriodConfirmed: confirmed,
            deferredStart: deferred
        )
    }

    func testRefusedAfterChoosingToLookWithoutStarting() {
        XCTAssertFalse(canAdd(start: "2026-09-10", confirmed: false, deferred: "2026-09-10"))
    }

    func testAllowedWhenNobodyDeferred() {
        XCTAssertTrue(canAdd(start: "2026-09-10", confirmed: false, deferred: nil))
    }

    func testAllowedInAFreshlyOnboardedHousehold() {
        // The case that made the first version wrong on the web: a new
        // household's period IS unconfirmed, so a rule keyed on that locks it
        // out of its first expense.
        XCTAssertTrue(canAdd(start: "2026-09-10", confirmed: false, deferred: nil))
    }

    func testStopsApplyingOnceThePeriodIsAnswered() {
        // Answering does not clear the in-memory deferral, so without the
        // `confirmed` check the block outlived the decision.
        XCTAssertTrue(canAdd(start: "2026-09-10", confirmed: true, deferred: "2026-09-10"))
    }

    func testDeferringOnePeriodDoesNotBlockTheNext() {
        XCTAssertTrue(canAdd(start: "2026-10-08", confirmed: false, deferred: "2026-09-10"))
    }

    func testAllowedWhenNoPeriodIsMaterialized() {
        XCTAssertTrue(canAdd(start: nil, confirmed: false, deferred: "anything"))
    }
}
