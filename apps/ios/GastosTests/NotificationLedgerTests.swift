import XCTest

/// What the background refresh announces — see NotificationLedger.
final class NotificationLedgerTests: XCTestCase {
    func testTheFirstLookAnnouncesNothing() {
        // Turning the alerts on must not replay the last fifty charges.
        let run = NotificationLedger.fresh(["a", "b", "c"], seen: nil)
        XCTAssertEqual(run.announce, [])
        XCTAssertEqual(run.seen, ["a", "b", "c"])
    }

    func testAnnouncesOnlyWhatIsNew_inOrder() {
        let run = NotificationLedger.fresh(["a", "x", "b", "y"], seen: ["a", "b"])
        XCTAssertEqual(run.announce, ["x", "y"])
        XCTAssertEqual(run.seen, ["a", "b", "x", "y"])
    }

    func testAnnouncesEachIdOnce() {
        let first = NotificationLedger.fresh(["a", "x"], seen: ["a"])
        let second = NotificationLedger.fresh(["a", "x"], seen: first.seen)
        XCTAssertEqual(first.announce, ["x"])
        XCTAssertEqual(second.announce, [])
    }

    func testAnEmptySeenListIsABaselineNotAMissingOne() {
        // [] means "looked, saw nothing": what arrives next is news.
        XCTAssertEqual(NotificationLedger.fresh(["x"], seen: []).announce, ["x"])
    }

    func testDuplicatesAndEmptyIdsAreIgnored() {
        let run = NotificationLedger.fresh(["x", "", "x"], seen: [])
        XCTAssertEqual(run.announce, ["x"])
        XCTAssertEqual(run.seen, ["x"])
    }

    func testMarkingRecordsWithoutAnnouncing() {
        let seen = NotificationLedger.marking(["a", "b"], seen: [])
        XCTAssertEqual(seen, ["a", "b"])
        // What the open app showed is not announced by the next run.
        XCTAssertEqual(NotificationLedger.fresh(["a", "b", "c"], seen: seen).announce, ["c"])
        XCTAssertEqual(NotificationLedger.marking(["b", "c"], seen: seen), ["a", "b", "c"])
    }

    /// The bug as it shipped: the open app marked this period's two expenses,
    /// which counted as a baseline, and the first run — reading 45 days —
    /// announced every older one.
    func testMarkingNeverStartsTheBaseline() {
        let marked = NotificationLedger.marking(["this-period"], seen: nil)
        XCTAssertNil(marked)
        let run = NotificationLedger.fresh(["weeks-old", "older", "this-period"], seen: marked)
        XCTAssertEqual(run.announce, [])
        XCTAssertEqual(run.seen, ["weeks-old", "older", "this-period"])
    }

    func testStaysBoundedKeepingTheNewest() {
        let run = NotificationLedger.fresh(["d", "e"], seen: ["a", "b", "c"], cap: 3)
        XCTAssertEqual(run.announce, ["d", "e"])
        XCTAssertEqual(run.seen, ["c", "d", "e"])
        XCTAssertEqual(NotificationLedger.marking(["d"], seen: ["a", "b", "c"], cap: 3), ["b", "c", "d"])
    }
}
