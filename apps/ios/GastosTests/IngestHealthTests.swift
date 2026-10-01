import XCTest

/// IngestHealth against `shared/ingest-vectors.json`, the cases the web's
/// `ingestHealth` runs too.
final class IngestHealthTests: XCTestCase {

    private struct Vectors: Decodable {
        struct Case: Decodable {
            let name: String
            let ranAt: String?
            let now: String
            let expected: String
            let hours: Int?
        }
        let staleAfterMinutes: Int
        let cases: [Case]
    }

    private func load() throws -> Vectors {
        let url = try XCTUnwrap(
            Bundle(for: IngestHealthTests.self)
                .url(forResource: "ingest-vectors", withExtension: "json")
        )
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    func testEveryCaseInTheSharedFile() throws {
        let vectors = try load()
        XCTAssertEqual(IngestHealth.staleAfterMinutes, vectors.staleAfterMinutes)
        // Exact: the population is the file's own list, closed by construction.
        XCTAssertEqual(vectors.cases.count, 7)
        let iso = ISO8601DateFormatter()
        for vector in vectors.cases {
            let ranAt = try vector.ranAt.map { try XCTUnwrap(iso.date(from: $0), vector.name) }
            let now = try XCTUnwrap(iso.date(from: vector.now), vector.name)
            let expected: IngestHealth = switch vector.expected {
            case "unknown": .unknown
            case "fresh": .fresh(hours: vector.hours ?? -1)
            default: .stale(hours: vector.hours ?? -1)
            }
            XCTAssertEqual(IngestHealth.of(ranAt: ranAt, now: now), expected, vector.name)
        }
    }
}
