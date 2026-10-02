import XCTest

/// One number format for the whole app since 2026-10-02 (Cristian's call),
/// the same as the web's lib/money.ts: a point for the decimals, nothing for
/// the thousands, in both languages and for pesos too. Written out by hand
/// rather than worked out by the formatter under test.
final class MoneyFormatterTests: XCTestCase {

    private let spanish = Locale(identifier: "es_AR")
    private let english = Locale(identifier: "en_AU")

    func testAPointAndNoGroupingInEitherLanguage() {
        for locale in [spanish, english] {
            XCTAssertEqual(MoneyFormatter.aud(105000, locale: locale), "$1050.00")
            XCTAssertEqual(MoneyFormatter.aud(4280, locale: locale), "$42.80")
            XCTAssertEqual(MoneyFormatter.audCompact(90000, locale: locale), "$900")
            XCTAssertEqual(MoneyFormatter.audCompact(123456, locale: locale), "$1234.56")
            XCTAssertEqual(MoneyFormatter.usd(18690, locale: locale), "US$ 186.90")
            XCTAssertEqual(MoneyFormatter.usd(123456, locale: locale), "US$ 1234.56")
            XCTAssertEqual(MoneyFormatter.plainAmount(123456, locale: locale), "1234.56")
        }
    }

    func testPesosToo() {
        XCTAssertEqual(MoneyFormatter.ars(24140275, locale: spanish), "$ 241402.75")
    }

    func testRates() {
        XCTAssertEqual(MoneyFormatter.rate(0.6521), "0.652")
        XCTAssertEqual(MoneyFormatter.rate(1500, digits: 2, minDigits: 0), "1500")
        XCTAssertEqual(MoneyFormatter.rate(1500.5, digits: 2, minDigits: 0), "1500.5")
    }

    func testTheKeypadWritesAPoint() {
        XCTAssertEqual(MoneyFormatter.decimalSeparator, ".")
    }
}
