import XCTest

/// The merchant display form, against shared/merchant-name-vectors.json — the
/// web's `displayMerchant` runs the same file. One test walking the list, so an
/// emptied or renamed section fails instead of quietly covering nothing.
final class MerchantNameTests: XCTestCase {
    private struct Vectors: Decodable {
        struct Case: Decodable {
            let raw: String
            let display: String
            let why: String
        }
        let cases: [Case]
    }

    func testEveryVectorGetsItsDisplayForm() throws {
        let url = try XCTUnwrap(
            Bundle(for: MerchantNameTests.self)
                .url(forResource: "merchant-name-vectors", withExtension: "json"),
            "merchant-name-vectors.json missing from the test bundle"
        )
        let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(vectors.cases.count, 10)
        let wrong = vectors.cases
            .filter { MerchantName.display($0.raw) != $0.display }
            .map { "\"\($0.raw)\" → \"\(MerchantName.display($0.raw))\", expected \"\($0.display)\" (\($0.why))" }
        XCTAssertEqual(wrong, [], wrong.joined(separator: "\n"))
    }
}
