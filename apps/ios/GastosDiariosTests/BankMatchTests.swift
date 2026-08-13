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

// MARK: - Routing a charge by its card

/// Which screen a bank charge belongs to, given the household's cards.
///
/// The TypeScript twin is `classifyCharge` in apps/web/src/lib/cards.ts. Unlike
/// the period and matching arithmetic this is NOT driven by shared vectors: it
/// is a dictionary lookup with a fallback, not a calculation the two platforms
/// can drift apart on. What is worth pinning down is the fallback itself —
/// an unidentified charge must never disappear from this app.
final class ChargeRoutingTests: XCTestCase {

    /// Cristian's real pair: 2024 is the debit card, 6576 the credit one.
    private func household(cards: [String: HouseholdCard]?) -> Household {
        Household(
            name: "Merlines",
            currency: "AUD",
            timezone: "Australia/Sydney",
            defaultBudget: DefaultBudget(
                amountCents: 17000, period: .weekly, anchorDate: "2026-07-17"
            ),
            memberIds: ["u1"],
            memberProfiles: [:],
            categories: [:],
            cards: cards
        )
    }

    private let configured: [String: HouseholdCard] = [
        "2024": HouseholdCard(kind: "debit"),
        "6576": HouseholdCard(kind: "credit", brand: "visa"),
    ]

    func testRoutesByTheDigitsTheBankPrinted() {
        let h = household(cards: configured)
        XCTAssertEqual(h.routing(forCardLast4: "2024"), .debit)
        XCTAssertEqual(h.routing(forCardLast4: "6576"), .credit)
    }

    func testAnythingUnidentifiedIsUnknown() {
        let h = household(cards: configured)
        XCTAssertEqual(h.routing(forCardLast4: "9999"), .unknown)
        XCTAssertEqual(h.routing(forCardLast4: nil), .unknown)
        XCTAssertEqual(h.routing(forCardLast4: ""), .unknown)
        // A value a newer client might write must not crash or be mistaken for
        // one of the two we know.
        XCTAssertEqual(
            household(cards: ["1234": HouseholdCard(kind: "prepaid")])
                .routing(forCardLast4: "1234"),
            .unknown
        )
    }

    func testCreditIsTheONLYThingThisAppHides() {
        let h = household(cards: configured)
        XCTAssertTrue(h.belongsToExpenses(cardLast4: "2024"))
        XCTAssertFalse(h.belongsToExpenses(cardLast4: "6576"))
        // The invariant that matters: an unidentified charge stays visible here,
        // because the web shows it too and losing it is worse than repeating it.
        XCTAssertTrue(h.belongsToExpenses(cardLast4: "9999"))
        XCTAssertTrue(h.belongsToExpenses(cardLast4: nil))
    }

    func testEverythingShowsUntilCardsAreConfigured() {
        // The state every household is in today, and returns to if cleared.
        for cards in [nil, [:]] as [[String: HouseholdCard]?] {
            let h = household(cards: cards)
            XCTAssertTrue(h.belongsToExpenses(cardLast4: "2024"))
            XCTAssertTrue(h.belongsToExpenses(cardLast4: "6576"))
        }
    }
}
