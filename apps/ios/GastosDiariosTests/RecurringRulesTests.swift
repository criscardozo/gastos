import XCTest

/// Runs `shared/recurring-vectors.json` against the Swift matcher. The
/// TypeScript one runs the same file in apps/web/src/lib/recurring.test.ts —
/// that shared file is the only thing keeping two implementations of a pattern
/// language from drifting apart.
final class RecurringRulesTests: XCTestCase {

    private struct Vectors: Decodable {
        struct MatchCase: Decodable {
            let name: String
            let pattern: String
            let merchant: String
            let expected: Bool
        }
        struct FirstCase: Decodable {
            let name: String
            let patterns: [String]
            let merchant: String
            let expected: String?
        }
        struct EstimateCase: Decodable {
            let name: String
            let usdCents: Int
            let rate: Double?
            let expected: Int?
        }
        struct Matches: Decodable { let cases: [MatchCase] }
        struct Estimate: Decodable { let cases: [EstimateCase] }
        struct FirstMatch: Decodable { let cases: [FirstCase] }
        let matches: Matches
        let firstMatch: FirstMatch
        let estimate: Estimate
    }

    private struct Rule: RecurringRuleLike {
        let pattern: String
        let amountAudCents: Int?
    }

    private static let vectors: Vectors = {
        guard let url = Bundle(for: RecurringRulesTests.self)
            .url(forResource: "recurring-vectors", withExtension: "json") else {
            fatalError("recurring-vectors.json missing from the test bundle")
        }
        do {
            return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        } catch {
            fatalError("Could not decode recurring-vectors.json: \(error)")
        }
    }()

    /// A group added to the file that no test reads would leave this suite
    /// green while covering nothing — the same guard the period vectors carry.
    func testEveryVectorIsActuallyRun() {
        XCTAssertEqual(
            Self.vectors.matches.cases.count
                + Self.vectors.firstMatch.cases.count
                + Self.vectors.estimate.cases.count,
            30
        )
    }

    func testPatternsMatchTheSharedVectors() {
        for c in Self.vectors.matches.cases {
            XCTAssertEqual(
                RecurringRules.matches(pattern: c.pattern, merchant: c.merchant),
                c.expected,
                "\(c.name) — pattern \"\(c.pattern)\" against \"\(c.merchant)\""
            )
        }
    }

    func testTheMostSpecificRuleWins() {
        for c in Self.vectors.firstMatch.cases {
            let chosen = RecurringRules.rule(
                for: c.merchant,
                in: c.patterns.map { Rule(pattern: $0, amountAudCents: 1500) }
            )
            XCTAssertEqual(chosen?.pattern, c.expected, c.name)
        }
    }

    func testEstimatesMatchTheSharedVectors() {
        for c in Self.vectors.estimate.cases {
            XCTAssertEqual(
                RecurringRules.estimateAudCents(usdCents: c.usdCents, rate: c.rate),
                c.expected,
                "\(c.name) — US$ \(c.usdCents) at \(String(describing: c.rate))"
            )
        }
    }

    /// The one outcome a rule must never have, asserted rather than assumed.
    func testARuleNeverClaimsEverything() {
        for pattern in ["", "   ", "*", "***"] {
            XCTAssertFalse(
                RecurringRules.matches(pattern: pattern, merchant: "OPAL AUCKLAND ST"),
                "\"\(pattern)\" must claim nothing"
            )
        }
    }
}
