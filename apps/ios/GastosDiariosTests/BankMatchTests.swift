import XCTest
@testable import GastosDiarios

/// Runs `shared/bank-match-vectors.json` (bundled as a test resource) against
/// the Swift matcher. The TypeScript one runs the same file in
/// apps/web/src/lib/bank-match-vectors.test.ts — that shared file is the only
/// thing that keeps two implementations of this from drifting apart.
final class BankMatchTests: XCTestCase {

    // MARK: Vector shapes

    private struct Vectors: Decodable {
        struct RateCase: Decodable {
            struct Pair: Decodable {
                let amountCents: Int
                let usdCents: Int?
                let verified: Bool
            }
            let name: String
            let expenses: [Pair]
            let expected: Double?
        }

        struct MatchCase: Decodable {
            struct Charge: Decodable {
                let id: String
                let usdCents: Int
                let date: String
                let merchant: String
            }
            struct Candidate: Decodable {
                let id: String
                let amountCents: Int
                let date: String
                let note: String
                let verified: Bool
            }
            let name: String
            let referenceRate: Double?
            let charges: [Charge]
            let expenses: [Candidate]
            /// chargeId → expenseId, with null meaning "no suggestion".
            let expected: [String: String?]
        }

        let learnRate: [RateCase]
        let suggestMatches: [MatchCase]
    }

    private static let vectors: Vectors = {
        guard let url = Bundle(for: BankMatchTests.self)
            .url(forResource: "bank-match-vectors", withExtension: "json") else {
            fatalError("bank-match-vectors.json missing from the test bundle")
        }
        do {
            return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        } catch {
            fatalError("Could not decode bank-match-vectors.json: \(error)")
        }
    }()

    // MARK: Builders

    private func expense(
        id: String,
        amountCents: Int,
        date: String = "2026-08-03",
        note: String = "",
        usdCents: Int? = nil,
        verified: Bool = false
    ) -> Expense {
        var expense = Expense(
            amountCents: amountCents,
            categoryId: "groceries",
            note: note,
            date: date,
            createdBy: "u1"
        )
        expense.id = id
        expense.usdCents = usdCents
        expense.verified = verified
        return expense
    }

    private func charge(id: String, usdCents: Int, date: String, merchant: String) -> BankCharge {
        var charge = BankCharge(usdCents: usdCents, date: date, merchant: merchant)
        charge.docId = id
        return charge
    }

    // MARK: The vectors

    func testLearnRateVectors() {
        for testCase in Self.vectors.learnRate {
            let expenses = testCase.expenses.enumerated().map { index, pair in
                expense(
                    id: "e\(index)",
                    amountCents: pair.amountCents,
                    usdCents: pair.usdCents,
                    verified: pair.verified
                )
            }
            let rate = BankMatch.learnRate(expenses)
            if let expected = testCase.expected {
                guard let rate else {
                    XCTFail("\(testCase.name): expected \(expected), got nil")
                    continue
                }
                XCTAssertEqual(rate, expected, accuracy: 0.000001, testCase.name)
            } else {
                XCTAssertNil(rate, testCase.name)
            }
        }
    }

    func testSuggestMatchesVectors() {
        for testCase in Self.vectors.suggestMatches {
            let charges = testCase.charges.map {
                charge(id: $0.id, usdCents: $0.usdCents, date: $0.date, merchant: $0.merchant)
            }
            let expenses = testCase.expenses.map {
                expense(
                    id: $0.id,
                    amountCents: $0.amountCents,
                    date: $0.date,
                    note: $0.note,
                    usdCents: $0.verified ? Int(Double($0.amountCents) * 0.7123) : nil,
                    verified: $0.verified
                )
            }
            let suggestions = BankMatch.suggestMatches(
                charges: charges,
                expenses: expenses,
                referenceRate: testCase.referenceRate
            )
            XCTAssertEqual(
                suggestions.count,
                charges.count,
                "\(testCase.name): one suggestion per charge"
            )
            for suggestion in suggestions {
                let expected = testCase.expected[suggestion.chargeId] ?? nil
                XCTAssertEqual(
                    suggestion.expenseId,
                    expected,
                    "\(testCase.name) · charge \(suggestion.chargeId)"
                )
            }
        }
    }

    // MARK: Details the vectors don't pin down

    func testTokensFoldAccentsAndDropShortWords() {
        XCTAssertEqual(BankMatch.tokens("Farmacía 12"), ["farmacia"])
        XCTAssertEqual(BankMatch.tokens("COLES 0831"), ["coles"])
        // Two-letter words carry no signal and would match far too much.
        XCTAssertEqual(BankMatch.tokens("La Ñ de oro"), ["oro"])
    }

    func testMerchantScoreNormalizesByTheShorterSide() {
        XCTAssertEqual(
            BankMatch.merchantScore(merchant: "COLES 0831", note: "Coles"),
            1,
            accuracy: 0.000001
        )
        XCTAssertEqual(
            BankMatch.merchantScore(merchant: "", note: "Coles"),
            0,
            accuracy: 0.000001
        )
    }

    func testDateScoreDecays() {
        XCTAssertEqual(BankMatch.dateScore(gap: 0), 1)
        XCTAssertGreaterThan(BankMatch.dateScore(gap: 1), BankMatch.dateScore(gap: 2))
        XCTAssertEqual(BankMatch.dateScore(gap: 9), 0.2)
    }
}
