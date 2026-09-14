import XCTest

/// The twin of apps/web/src/lib/period-source.test.ts.
final class PeriodSourceTests: XCTestCase {
    func testTheUsualFigureIsNotAdjusted() {
        // The reported case: weekly default of $170, carry declined, period
        // reading exactly $170.
        XCTAssertEqual(PeriodSource.of(amountCents: 17000, defaultAmountCents: 17000), "default")
    }

    func testCarryingALeftoverIsAdjusted() {
        // $900 usual plus $200 left over is not the usual figure, and the
        // badge is how somebody learns this week is not comparable.
        XCTAssertEqual(PeriodSource.of(amountCents: 110000, defaultAmountCents: 90000), "custom")
    }

    func testATypedAmountIsAdjusted() {
        XCTAssertEqual(PeriodSource.of(amountCents: 50000, defaultAmountCents: 90000), "custom")
    }

    func testItDoesNotCallEverythingAdjusted() {
        XCTAssertEqual(PeriodSource.of(amountCents: 90000, defaultAmountCents: 90000), "default")
    }
}
