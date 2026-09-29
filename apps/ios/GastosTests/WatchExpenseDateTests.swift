import XCTest

/// The date an expense typed on the watch is filed under.
///
/// The watch formatted "today" in ITS OWN timezone, and the phone filed that
/// string as it came — the one place in either app where an expense date was
/// the device's rather than the household's.
final class WatchExpenseDateTests: XCTestCase {

    private let sydney = TimeZone(identifier: "Australia/Sydney")!
    /// 2026-09-28T14:30:00Z: half past midnight on the 29th in Sydney (AEST,
    /// before the October DST start), still the 28th in UTC.
    private let lateNight: Double = 1_790_605_800

    func testTheInstantIsReadInTheHouseholdTimezone() {
        let date = WatchExpenseDate.resolve(
            enteredAt: lateNight, dateYMD: "2026-09-28", householdTimeZone: sydney
        )
        XCTAssertEqual(date?.raw, "2026-09-29",
                       "a watch on UTC sent the 28th; the household's day is the 29th")
    }

    func testAnOlderWatchWithOnlyTheStringStillFiles() {
        let date = WatchExpenseDate.resolve(
            enteredAt: nil, dateYMD: "2026-09-28", householdTimeZone: sydney
        )
        XCTAssertEqual(date?.raw, "2026-09-28")
    }

    func testNothingUsableIsDropped() {
        XCTAssertNil(WatchExpenseDate.resolve(
            enteredAt: nil, dateYMD: "not a date", householdTimeZone: sydney
        ))
    }
}
