import XCTest
@testable import GastosDiarios

/// `BudgetEntryAmount` is the entry model shared by the four budget editors and
/// the expense form. AUD is the only currency anyone types, so these tests pin
/// the keypad → integer-cents contract, independent of any SwiftUI view.
final class BudgetEntryAmountTests: XCTestCase {

    func testTypedAmountBecomesIntegerCents() {
        var value = BudgetEntryAmount()
        value.input = .fromCents(1050)
        XCTAssertEqual(value.audCents, 1050)
    }

    func testEmptyAmountIsZeroSoTheSaveCTAStaysDisabled() {
        XCTAssertEqual(BudgetEntryAmount().audCents, 0)
    }

    func testFromAUDCentsSeedsTheEditor() {
        let value = BudgetEntryAmount.fromAUDCents(90000)
        XCTAssertEqual(value.audCents, 90000)
        XCTAssertEqual(value.input.cents, 90000)
    }

    func testSetAUDCentsReplacesTheTypedValue() {
        var value = BudgetEntryAmount.fromAUDCents(700)
        value.setAUDCents(900)
        XCTAssertEqual(value.audCents, 900)
    }

    func testTapForwardsToTheKeypadInput() {
        var value = BudgetEntryAmount()
        value.tap(.digit(1))
        value.tap(.digit(2))
        XCTAssertEqual(value.audCents, BudgetEntryAmount.fromAUDCents(1200).audCents)
    }
}
