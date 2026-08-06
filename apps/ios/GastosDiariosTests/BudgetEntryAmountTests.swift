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

/// The text a `TextField` is bound to. An editable field must NOT carry a
/// literal "0": the caret lands beside it and every amount comes out with a
/// leading zero the user has to delete.
final class AmountInputEditingTests: XCTestCase {

    func testEmptyInputGivesAnEmptyFieldSoThePlaceholderShows() {
        XCTAssertEqual(AmountInput().editingText(separator: ","), "")
        // The read-only rendering still wants its "0".
        XCTAssertEqual(AmountInput().display(separator: ","), "0")
    }

    func testTypedValueUsesTheLocaleSeparator() {
        var input = AmountInput()
        input.setDisplay("12,50", separator: ",")
        XCTAssertEqual(input.editingText(separator: ","), "12,50")
        XCTAssertEqual(input.editingText(separator: "."), "12.50")
        XCTAssertEqual(input.cents, 1250)
    }

    func testALeadingZeroTypedByHandIsDropped() {
        var input = AmountInput()
        input.setDisplay("012", separator: ",")
        XCTAssertEqual(input.editingText(separator: ","), "12")
    }

    func testAZeroOnItsOwnSurvives() {
        // "0," is a real intermediate state while typing "0,50".
        var input = AmountInput()
        input.setDisplay("0,", separator: ",")
        XCTAssertEqual(input.editingText(separator: ","), "0,")
    }
}
