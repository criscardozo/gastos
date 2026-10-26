import XCTest

final class BankNotificationTests: XCTestCase {

    private func charge(_ text: String) -> BankNotification.Charge? {
        if case .success(let c) = BankNotification.parse(text) { return c }
        return nil
    }

    func testReadsTheNotificationsBBVASent() {
        // Verbatim from the phone, 24 and 26 October 2026.
        XCTAssertEqual(
            charge("Por USD7,24 a ALDI STORES, con tu tarjeta Visa *2024"),
            .init(usdCents: 724, merchant: "ALDI STORES", cardLast4: "2024")
        )
        XCTAssertEqual(
            charge("Por USD35,35 a WOOLWORTHS/ROCKDAL, con tu tarjeta Visa *2024"),
            .init(usdCents: 3535, merchant: "WOOLWORTHS/ROCKDAL", cardLast4: "2024")
        )
        XCTAssertEqual(
            charge("Por USD15,53 a SQ *OLIVER BROWN R, con tu tarjeta Visa *2024"),
            .init(usdCents: 1553, merchant: "SQ *OLIVER BROWN R", cardLast4: "2024")
        )
        XCTAssertEqual(
            charge("Por USD235,59 a Coles Online, con tu tarjeta Visa *6576"),
            .init(usdCents: 23559, merchant: "Coles Online", cardLast4: "6576")
        )
    }

    func testCopesWithTheTitleAndThousands() {
        XCTAssertEqual(
            charge("Compra aprobada\nPor USD1.234,56 a QANTAS, con tu tarjeta Visa *6576"),
            .init(usdCents: 123456, merchant: "QANTAS", cardLast4: "6576")
        )
        XCTAssertEqual(charge("Por USD8 a OPAL, con tu tarjeta Visa *2024")?.usdCents, 800)
        XCTAssertEqual(charge("Por USD8,5 a OPAL, con tu tarjeta Visa *2024")?.usdCents, 850)
    }

    func testRefusesWhatIsNotACharge() {
        XCTAssertEqual(
            BankNotification.parse("Tu resumen ya está disponible"),
            .failure(.notACharge("Tu resumen ya está disponible"))
        )
        // A dot for decimals is not the bank's shape: refused, not read as 6390.
        XCTAssertEqual(
            BankNotification.parse("Por USD63.90 a COLES, con tu tarjeta Visa *2024"),
            .failure(.unreadableAmount("63.90"))
        )
    }

    func testTheChargeIdMatchesTheSharedVectors() throws {
        struct Vectors: Decodable {
            struct Case: Decodable {
                let name: String
                let date: String
                let usdCents: Int
                let cardLast4: String?
                let expected: String
            }
            let cases: [Case]
        }
        let url = try XCTUnwrap(
            Bundle(for: BankNotificationTests.self)
                .url(forResource: "bank-charge-id-vectors", withExtension: "json")
        )
        let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(vectors.cases.count, 2)
        for c in vectors.cases {
            XCTAssertEqual(
                BankNotification.chargeId(date: c.date, usdCents: c.usdCents, cardLast4: c.cardLast4),
                c.expected, c.name
            )
        }
    }
}
