import XCTest

final class MerchantNameTests: XCTestCase {
    func testAllCapsBecomesWordCapitalised() {
        XCTAssertEqual(MerchantName.display("CAFE MARTINEZ"), "Cafe Martinez")
        XCTAssertEqual(MerchantName.display("COLES 0831"), "Coles 0831")
    }

    func testPunctuationDoesNotStartAWord() {
        XCTAssertEqual(MerchantName.display("NETFLIX.COM"), "Netflix.com")
    }

    func testMixedCaseIsLeftAsWritten() {
        XCTAssertEqual(MerchantName.display("iTunes Store"), "iTunes Store")
        XCTAssertEqual(MerchantName.display("McDonald's"), "McDonald's")
    }

    func testNoLettersAndEmptyAreUntouched() {
        XCTAssertEqual(MerchantName.display("7-11 0042"), "7-11 0042")
        XCTAssertEqual(MerchantName.display(""), "")
    }

    func testAccentedCapitalsLowerCorrectly() {
        XCTAssertEqual(MerchantName.display("PANADERÍA ÑANDÚ"), "Panadería Ñandú")
    }

    func testSpacingIsPreserved() {
        XCTAssertEqual(MerchantName.display("TRANSPORT  FOR NSW"), "Transport  For Nsw")
    }
}
