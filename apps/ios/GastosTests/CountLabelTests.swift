import XCTest

/// Counted labels have to agree in number.
///
/// The catalog holds plain `%d` format strings and `L10n.t` resolves them with
/// `String(format:)`, which knows nothing about plurals — so a label written as
/// "%d descartados" renders "1 descartados". The project's answer is a
/// singular/plural key pair chosen in Swift (see `L10n.daysCount`), and these
/// tests pin the ones that count things.
///
/// Found by looking at the screen in a Simulator, not by reading the code:
/// nothing here fails to compile and no other test noticed.
final class CountLabelTests: XCTestCase {

    private let es = L10n(language: "es")
    private let en = L10n(language: "en")

    func testDiscardedChargesAgreeInNumber() {
        XCTAssertEqual(es.dismissedChargesCount(1), "1 descartado")
        XCTAssertEqual(es.dismissedChargesCount(3), "3 descartados")
        XCTAssertEqual(en.dismissedChargesCount(1), "1 discarded")
        XCTAssertEqual(en.dismissedChargesCount(3), "3 discarded")
    }

    func testPendingBankChargesAgreeInNumber() {
        XCTAssertEqual(es.bankChargesCount(1), "1 cargo del banco")
        XCTAssertEqual(es.bankChargesCount(2), "2 cargos del banco")
        XCTAssertEqual(en.bankChargesCount(1), "1 bank charge")
        XCTAssertEqual(en.bankChargesCount(2), "2 bank charges")
    }

    func testDaysStillAgree() {
        // The pair that already existed, so a change to the helper cannot
        // quietly break the case that was right all along.
        XCTAssertEqual(es.daysCount(1), "1 día")
        XCTAssertEqual(es.daysCount(5), "5 días")
    }
}
