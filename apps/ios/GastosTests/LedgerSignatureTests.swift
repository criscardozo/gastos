import XCTest

final class LedgerSignatureTests: XCTestCase {
    private func expense(
        _ id: String, amount: Int = 1_250, date: String = "2026-09-28",
        category: String = "coffee", verified: Bool? = nil
    ) -> Expense {
        Expense(
            id: id, amountCents: amount, categoryId: category, note: "n",
            date: date, createdBy: "u1", verified: verified
        )
    }

    func testTheOrderOfDeliveryIsNotAChange() {
        XCTAssertEqual(
            LedgerSignature.of([expense("a"), expense("b", amount: 4_000)]),
            LedgerSignature.of([expense("b", amount: 4_000), expense("a")])
        )
    }

    func testWhatTheSumDoesNotReadIsNotAChange() {
        XCTAssertEqual(
            LedgerSignature.of([expense("a", verified: false)]),
            LedgerSignature.of([expense("a", verified: true)])
        )
    }

    func testEachThingTheSumReadsIsAChange() {
        let base = LedgerSignature.of([expense("a"), expense("b")])
        XCTAssertNotEqual(LedgerSignature.of([expense("a")]), base)
        XCTAssertNotEqual(LedgerSignature.of([expense("a", amount: 1_251), expense("b")]), base)
        XCTAssertNotEqual(LedgerSignature.of([expense("a", date: "2026-10-01"), expense("b")]), base)
        XCTAssertNotEqual(LedgerSignature.of([expense("a", category: "other"), expense("b")]), base)
    }
}
