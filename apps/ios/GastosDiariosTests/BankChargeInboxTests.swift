import XCTest
@testable import GastosDiarios

/// The 48-hour window a dismissed bank charge can be taken back in.
///
/// The TypeScript twin is tested in apps/web/src/lib/bank-charges.test.ts with
/// the same cases. No shared JSON vectors here, unlike the period arithmetic
/// and the matcher: the only thing the two implementations must agree on is the
/// constant, which the first test pins.
final class BankChargeInboxTests: XCTestCase {

    private let now = Date(timeIntervalSince1970: 1_786_000_000)

    /// `hours` before `now`.
    private func ago(_ hours: Double) -> Date {
        now.addingTimeInterval(-hours * 3600)
    }

    private func charge(_ id: String, dismissedAt: Date?) -> BankCharge {
        BankCharge(
            docId: id,
            usdCents: 1000,
            date: "2026-08-14",
            merchant: "COLES 0831",
            cardLast4: nil,
            dismissedAt: dismissedAt
        )
    }

    func testWindowMatchesTheWeb() {
        // The web hard-codes the same number; if this changes, that does.
        XCTAssertEqual(BankChargeInbox.dismissWindowHours, 48)
    }

    func testPendingIsWhatWasNeverDismissed() {
        XCTAssertTrue(BankChargeInbox.isPending(charge("a", dismissedAt: nil)))
        XCTAssertFalse(BankChargeInbox.isPending(charge("a", dismissedAt: ago(1))))
    }

    func testFreshDismissalStaysRecoverable() {
        let c = charge("a", dismissedAt: ago(1))
        XCTAssertTrue(BankChargeInbox.isRecoverable(c, now: now))
        XCTAssertFalse(BankChargeInbox.isExpired(c, now: now))
    }

    func testPastTheWindowItIsExpired() {
        let c = charge("a", dismissedAt: ago(49))
        XCTAssertFalse(BankChargeInbox.isRecoverable(c, now: now))
        XCTAssertTrue(BankChargeInbox.isExpired(c, now: now))
    }

    func testExactlyFortyEightHoursIsOut() {
        // Keeps "recoverable for 48 hours" literally true.
        XCTAssertTrue(BankChargeInbox.isExpired(charge("a", dismissedAt: ago(48)), now: now))
        XCTAssertTrue(BankChargeInbox.isRecoverable(charge("a", dismissedAt: ago(47.98)), now: now))
    }

    func testAPendingChargeIsNeitherExpiredNorRecoverable() {
        // The sweep keys off isExpired, so a pending charge answering `true`
        // here would delete a charge nobody has even looked at.
        let c = charge("a", dismissedAt: nil)
        XCTAssertFalse(BankChargeInbox.isExpired(c, now: now))
        XCTAssertFalse(BankChargeInbox.isRecoverable(c, now: now))
    }

    func testAStampFromTheFutureNeverExpires() {
        // Clock skew between the server stamp and this device: err towards
        // keeping the charge, never towards deleting a recoverable one.
        XCTAssertFalse(BankChargeInbox.isExpired(charge("a", dismissedAt: ago(-2)), now: now))
    }

    func testPartitionSplitsTheThreeStatesAndLosesNothing() {
        let charges = [
            charge("pending", dismissedAt: nil),
            charge("fresh", dismissedAt: ago(2)),
            charge("stale", dismissedAt: ago(72)),
            charge("edge", dismissedAt: ago(47)),
        ]
        let result = BankChargeInbox.partition(charges, now: now)

        XCTAssertEqual(result.pending.map(\.id), ["pending"])
        XCTAssertEqual(result.dismissed.map(\.id), ["fresh", "edge"])
        XCTAssertEqual(result.expired.map(\.id), ["stale"])
        XCTAssertEqual(
            result.pending.count + result.dismissed.count + result.expired.count,
            charges.count
        )
    }

    func testNewestDismissalComesFirst() {
        // The likeliest slip is the most recent one, so it is the one on top.
        let result = BankChargeInbox.partition(
            [
                charge("old", dismissedAt: ago(40)),
                charge("new", dismissedAt: ago(1)),
                charge("mid", dismissedAt: ago(20)),
            ],
            now: now
        )
        XCTAssertEqual(result.dismissed.map(\.id), ["new", "mid", "old"])
    }

    func testEmptyInEmptyOut() {
        XCTAssertEqual(BankChargeInbox.partition([], now: now), BankChargeInbox.Partition())
    }
}
