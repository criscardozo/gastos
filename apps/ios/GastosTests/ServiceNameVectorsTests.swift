import XCTest

/// The fold that links a service to its charge, held to the shared vectors.
///
/// It exists twice — here and in `apps/web/src/lib/services.ts` — and the two
/// are not the same code: this one asks Foundation for a diacritic- and
/// case-insensitive folding, the web strips combining marks after NFD. Same
/// file, both sides, like the period arithmetic and the bank matcher.
///
/// It matters more since a recurring rule can file under a service's name: a
/// rule written on the phone has to link on the web and back, and a fold that
/// drifted would break it in the quiet way — the expense filed and correct,
/// the service still saying it was never charged.
///
/// One difference is deliberate and recorded in the vectors' own comment:
/// Foundation folds ß to ss and NFD cannot, since ß carries no combining
/// mark. It is not in the cases below because it is not settled, and a vector
/// that asserted either answer would be inventing one.
final class ServiceNameVectorsTests: XCTestCase {
    private struct Pair: Decodable {
        let a: String
        let b: String
        let why: String
    }

    private struct Vectors: Decodable {
        let sameKey: [Pair]
        let differentKey: [Pair]
    }

    private static let vectors: Vectors = {
        guard let url = Bundle(for: ServiceNameVectorsTests.self)
            .url(forResource: "service-name-vectors", withExtension: "json") else {
            fatalError("service-name-vectors.json missing from the test bundle")
        }
        do {
            return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        } catch {
            fatalError("Could not decode service-name-vectors.json: \(error)")
        }
    }()

    /// A baseline that asserts something positive: an empty vectors file would
    /// make every loop below pass without comparing anything.
    func testVectorsAreLoaded() {
        XCTAssertGreaterThan(Self.vectors.sameKey.count, 3)
        XCTAssertGreaterThan(Self.vectors.differentKey.count, 2)
    }

    func testNamesThatMustLink() {
        for pair in Self.vectors.sameKey {
            XCTAssertEqual(
                ServiceLogic.nameKey(pair.a),
                ServiceLogic.nameKey(pair.b),
                "\(pair.a) should link to \(pair.b) — \(pair.why)"
            )
        }
    }

    func testNamesThatMustNot() {
        for pair in Self.vectors.differentKey {
            XCTAssertNotEqual(
                ServiceLogic.nameKey(pair.a),
                ServiceLogic.nameKey(pair.b),
                "\(pair.a) should NOT link to \(pair.b) — \(pair.why)"
            )
        }
    }
}
