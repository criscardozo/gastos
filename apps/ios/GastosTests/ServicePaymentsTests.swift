import XCTest

/// Last month's Servicios payments, against shared/service-payments-vectors.json
/// — the cases the web's lib/service-payments.ts runs too.
final class ServicePaymentsTests: XCTestCase {

    private struct Vectors: Decodable {
        struct Month: Decodable { let today: String; let startDate: String; let endDate: String }
        struct Row: Decodable {
            let id: String; let amountCents: Int; let categoryId: String
            let note: String; let date: String; let usdCents: Int?
        }
        struct Expected: Decodable {
            let ids: [String]; let totalAudCents: Int; let totalUsdCents: Int; let unverified: Int
        }
        struct Case: Decodable { let name: String; let expenses: [Row]; let expected: Expected }
        let previousMonth: [Month]
        let payments: [Case]
    }

    private func load() throws -> Vectors {
        let url = try XCTUnwrap(
            Bundle(for: ServicePaymentsTests.self)
                .url(forResource: "service-payments-vectors", withExtension: "json")
        )
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    func testTheFileHasTheCasesItDeclares() throws {
        let vectors = try load()
        // Exact: the population is the file's own list, closed by construction.
        XCTAssertEqual(vectors.previousMonth.count, 4)
        XCTAssertEqual(vectors.payments.count, 3)
    }

    func testPreviousMonth() throws {
        for c in try load().previousMonth {
            let range = ServicePayments.previousMonth(today: try XCTUnwrap(CalendarDate(c.today)))
            XCTAssertEqual(range.start.raw, c.startDate, c.today)
            XCTAssertEqual(range.end.raw, c.endDate, c.today)
        }
    }

    func testPayments() throws {
        for c in try load().payments {
            let rows = c.expenses.map {
                ServicePayment(id: $0.id, amountCents: $0.amountCents, categoryId: $0.categoryId,
                               note: $0.note, date: $0.date, usdCents: $0.usdCents)
            }
            let result = ServicePayments.of(rows)
            XCTAssertEqual(result.rows.map(\.id), c.expected.ids, c.name)
            XCTAssertEqual(result.totalAudCents, c.expected.totalAudCents, c.name)
            XCTAssertEqual(result.totalUsdCents, c.expected.totalUsdCents, c.name)
            XCTAssertEqual(result.unverified, c.expected.unverified, c.name)
        }
    }
}
