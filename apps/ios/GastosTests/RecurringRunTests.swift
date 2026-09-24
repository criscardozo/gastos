import XCTest

/// The `run` cases of shared/recurring-vectors.json, against the Swift planner.
///
/// The web runs the same cases against `planRecurringRun`. Before this file the
/// decision of what a run files and asks was written inline in each client with
/// no vectors, and the two disagreed twice in one day.
final class RecurringRunTests: XCTestCase {

    private struct Vectors: Decodable {
        struct Run: Decodable { let cases: [Case] }
        struct Case: Decodable {
            struct Charge: Decodable, RecurringChargeLike {
                let id: String
                let merchant: String
                let usdCents: Int
            }
            struct Rule: Decodable, RecurringRuleLike {
                let pattern: String
                let amountAudCents: Int?
            }
            struct Expected: Decodable {
                struct Filed: Decodable, Equatable {
                    let charge: String
                    let amountAudCents: Int
                    let estimated: Bool
                }
                let fresh: [String]
                let file: [Filed]
                let ask: [String]
            }
            let name: String
            let pending: [Charge]
            let rules: [Rule]
            let learnedRate: Double?
            let seen: [String]
            let filed: [String]
            let expected: Expected
        }
        let run: Run
    }

    private static let vectors: Vectors = {
        guard let url = Bundle(for: RecurringRunTests.self)
            .url(forResource: "recurring-vectors", withExtension: "json") else {
            fatalError("recurring-vectors.json missing from the test bundle")
        }
        do {
            return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        } catch {
            fatalError("Could not decode recurring-vectors.json: \(error)")
        }
    }()

    /// One test that walks every case, with a floor, so an emptied or renamed
    /// section fails instead of quietly producing no assertions.
    func testEveryRunCaseAgreesWithTheSharedVectors() {
        let cases = Self.vectors.run.cases
        XCTAssertGreaterThan(cases.count, 6)
        for c in cases {
            let plan = RecurringRules.planRun(
                pending: c.pending, rules: c.rules, learnedRate: c.learnedRate,
                seen: Set(c.seen), filed: Set(c.filed)
            )
            XCTAssertEqual(plan.fresh, c.expected.fresh, "\(c.name) — fresh")
            XCTAssertEqual(
                plan.file.map {
                    Vectors.Case.Expected.Filed(
                        charge: $0.charge.id,
                        amountAudCents: $0.amountAudCents ?? -1,
                        estimated: $0.estimated
                    )
                },
                c.expected.file,
                "\(c.name) — file"
            )
            XCTAssertEqual(plan.ask.map(\.charge.id), c.expected.ask, "\(c.name) — ask")
        }
    }
}
