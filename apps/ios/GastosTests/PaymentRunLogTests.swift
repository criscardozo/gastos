import XCTest

/// The diagnostic record of the Shortcuts payment action.
final class PaymentRunLogTests: XCTestCase {
    private func entry(_ n: Int, outcome: String = PaymentRunLog.running) -> PaymentRunLog.Entry {
        PaymentRunLog.Entry(
            id: UUID(), startedAt: Date(timeIntervalSince1970: TimeInterval(n)),
            amount: "\(n)", currency: "AUD", merchant: "Shop \(n)", outcome: outcome
        )
    }

    func testNewestFirstAndCapped() {
        var log = PaymentRunLog()
        for n in 1...(PaymentRunLog.capacity + 3) { log.start(entry(n)) }
        XCTAssertEqual(log.entries.count, PaymentRunLog.capacity)
        XCTAssertEqual(log.entries.first?.amount, "\(PaymentRunLog.capacity + 3)")
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
