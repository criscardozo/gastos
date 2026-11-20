import XCTest

/// The diagnostic record of the Shortcuts payment action.
final class PaymentRunLogTests: XCTestCase {
    private func entry(_ n: Int, outcome: String = PaymentRunLog.running) -> PaymentRunLog.Entry {
        PaymentRunLog.Entry(
            id: UUID(), startedAt: Date().addingTimeInterval(TimeInterval(n)),
            amount: "\(n)", currency: "AUD", merchant: "Shop \(n)", outcome: outcome
        )
    }

    func testNewestFirst() {
        var log = PaymentRunLog()
        for n in 1...3 { log.start(entry(n)) }
        XCTAssertEqual(log.entries.map(\.amount), ["3", "2", "1"])
    }

    /// Whole months, not the last few runs: on 17/11 the two transfers that
    /// were filed as charges were still readable only because the log had
    /// not filled up yet.
    func testKeepsThisMonthAndTheOneBefore() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Australia/Sydney"))
        func at(_ y: Int, _ m: Int, _ d: Int) -> Date {
            calendar.date(from: DateComponents(year: y, month: m, day: d, hour: 12))!
        }
        var log = PaymentRunLog()
        for (n, date) in [at(2026, 9, 30), at(2026, 10, 1), at(2026, 10, 31), at(2026, 11, 17)].enumerated() {
            var e = entry(n)
            e.startedAt = date
            log.start(e, now: date, calendar: calendar)
        }
        XCTAssertEqual(log.entries.map(\.amount), ["3", "2", "1"], "September went once it was November")
        let months = log.byMonth(calendar: calendar)
        XCTAssertEqual(months.map(\.entries.count), [1, 2])
        XCTAssertEqual(months.first?.month, calendar.date(from: DateComponents(year: 2026, month: 11, day: 1)))
    }

    func testTheCeilingStillHolds() {
        var log = PaymentRunLog()
        let now = Date(timeIntervalSince1970: 1_000_000)
        for n in 1...(PaymentRunLog.capacity + 3) {
            var e = entry(n)
            e.startedAt = now
            log.start(e, now: now)
        }
        XCTAssertEqual(log.entries.count, PaymentRunLog.capacity)
        XCTAssertEqual(log.entries.last?.amount, "4", "the oldest three fall off")
    }

    func testFinishUpdatesOnlyItsOwnRun() {
        var log = PaymentRunLog()
        let first = entry(1), second = entry(2)
        log.start(first)
        log.start(second)
        log.finish(first.id, outcome: "saved")
        XCTAssertEqual(log.entries.map(\.outcome), [PaymentRunLog.running, "saved"])
        log.finish(UUID(), outcome: "saved")
        XCTAssertEqual(log.entries.count, 2, "an unknown run is not appended")
    }

    func testRoundTripsThroughDefaults() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "PaymentRunLogTests"))
        defaults.removePersistentDomain(forName: "PaymentRunLogTests")
        defer { defaults.removePersistentDomain(forName: "PaymentRunLogTests") }

        XCTAssertEqual(PaymentRunLog.load(from: defaults), PaymentRunLog(), "nothing stored reads as empty")
        var log = PaymentRunLog()
        var empty = entry(1)
        empty.amount = nil
        empty.merchant = nil
        log.start(empty)
        log.save(to: defaults)
        XCTAssertEqual(PaymentRunLog.load(from: defaults), log, "an empty parameter survives as nil")

        defaults.set(Data("not json".utf8), forKey: PaymentRunLog.defaultsKey)
        XCTAssertEqual(PaymentRunLog.load(from: defaults), PaymentRunLog(), "garbage reads as empty, not a crash")
    }
}
