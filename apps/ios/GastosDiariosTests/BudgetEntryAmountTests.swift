import XCTest

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

    /// The case that actually happened: the app in Spanish, the PHONE in
    /// English, so the decimal pad hands over "." while `separator` — which
    /// comes from the app's language — says ",".
    ///
    /// Ninety and twelve cents was typed as "90.12" and saved as $9.012,00,
    /// a hundred times over, because the earlier fix dropped the grouping mark
    /// outright instead of asking whether it was grouping anything.
    func testADecimalTypedWithTheOtherLocaleSeparator() {
        var input = AmountInput()
        input.setDisplay("90.12", separator: ",")
        XCTAssertEqual(input.cents, 9012)

        // And the mirror image: app in English, phone in Spanish.
        var english = AmountInput()
        english.setDisplay("90,12", separator: ".")
        XCTAssertEqual(english.cents, 9012)

        // One decimal digit is still a decimal, not a truncated thousand.
        var one = AmountInput()
        one.setDisplay("1.5", separator: ",")
        XCTAssertEqual(one.cents, 150)
    }

    /// A pasted amount carrying its grouping mark keeps its VALUE.
    ///
    /// The decimal pad has no grouping key, so this is the paste path — and it
    /// used to read "1.050" in Spanish as 1,05: a thousandth of the amount,
    /// large enough to look like a real expense. Same defect the web parser
    /// had (parseAmountToCents), found by the Stock session reviewing this one.
    func testPastedGroupingMarkIsNotADecimalPoint() {
        var spanish = AmountInput()
        spanish.setDisplay("1.050", separator: ",")
        XCTAssertEqual(spanish.cents, 105_000)

        spanish.setDisplay("1.234.567,89", separator: ",")
        XCTAssertEqual(spanish.cents, 123_456_789)

        var english = AmountInput()
        english.setDisplay("1,050", separator: ".")
        XCTAssertEqual(english.cents, 105_000)

        english.setDisplay("1,050.00", separator: ".")
        XCTAssertEqual(english.cents, 105_000)
    }
}
