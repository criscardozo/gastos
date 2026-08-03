import XCTest
@testable import GastosDiarios

/// An expense is verified only once the BANK has reported what it charged in
/// USD. `verified` is a stored flag, but a flag with no figure behind it means
/// nothing — these tests pin that reading, which the list indicator, the
/// verify sheet and the export gate all depend on.
final class ExpenseVerificationTests: XCTestCase {

    private func expense(usdCents: Int?, verified: Bool?) -> Expense {
        var expense = Expense(
            amountCents: 6390,
            categoryId: "groceries",
            note: "Coles",
            date: "2026-08-01",
            createdBy: "u1"
        )
        expense.usdCents = usdCents
        expense.verified = verified
        return expense
    }

    func testBothFieldsPresentIsVerified() {
        XCTAssertTrue(expense(usdCents: 4152, verified: true).isVerified)
    }

    func testAbsentFieldsReadAsUnverified() {
        // Expenses that predate the fields, and ones an older build created.
        XCTAssertFalse(expense(usdCents: nil, verified: nil).isVerified)
    }

    func testFlagWithoutTheFigureIsNotVerified() {
        XCTAssertFalse(expense(usdCents: nil, verified: true).isVerified)
    }

    func testFigureWithoutTheFlagIsNotVerified() {
        XCTAssertFalse(expense(usdCents: 4152, verified: false).isVerified)
    }

    func testFreshExpenseIsUnverified() {
        let fresh = Expense(
            amountCents: 1250,
            categoryId: "coffee",
            note: "",
            date: "2026-08-03",
            createdBy: "u1"
        )
        XCTAssertFalse(fresh.isVerified)
        XCTAssertNil(fresh.usdCents)
    }
}
