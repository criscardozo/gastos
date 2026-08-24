import XCTest

final class SuggestionsTests: XCTestCase {

    // Builds an Expense; `createdAt` is derived from `date` so recency ordering
    // (date desc, then createdAt desc) is deterministic in the tests.
    private func expense(
        _ id: String,
        cents: Int,
        category: String,
        note: String,
        date: String
    ) -> Expense {
        let formatter = ISO8601DateFormatter()
        let createdAt = formatter.date(from: "\(date)T12:00:00Z")
        return Expense(
            id: id,
            amountCents: cents,
            categoryId: category,
            note: note,
            date: date,
            createdBy: "u1",
            createdAt: createdAt,
            updatedAt: createdAt
        )
    }

    private var sample: [Expense] {
        [
            expense("1", cents: 1100, category: "coffee", note: "Café", date: "2026-07-01"),
            expense("2", cents: 4280, category: "coffee", note: "Café con leche", date: "2026-07-03"),
            expense("3", cents: 1100, category: "coffee", note: "Cafe", date: "2026-07-05"), // dup amount, more recent
            expense("4", cents: 0, category: "coffee", note: "", date: "2026-07-06"),        // zero + blank
            expense("5", cents: 900, category: "groceries", note: "Verdura", date: "2026-07-04"),
            expense("6", cents: 2500, category: "coffee", note: "Café", date: "2026-07-02"),
        ]
    }

    // MARK: topNotes

    func testTopNotesRankedByFrequencyThenRecency() {
        // "Café"/"Cafe" fold to the same key: appears 3× (id1, id3, id6) →
        // ranks first; "Café con leche" 1×.
        let notes = Suggestions.topNotes(from: sample, categoryId: "coffee", limit: 3)
        XCTAssertEqual(notes.first, "Cafe") // most recent occurrence display (id3, 07-05)
        XCTAssertEqual(notes.count, 2)
        XCTAssertTrue(notes.contains("Café con leche"))
    }

    func testTopNotesMatchingIsCaseAndDiacriticInsensitive() {
        let notes = Suggestions.topNotes(from: sample, categoryId: "coffee", matching: "cafe con")
        XCTAssertEqual(notes, ["Café con leche"])
    }

    func testTopNotesFallsBackToAllCategoriesWhenScopeEmpty() {
        // "home" has no expenses → falls back to overall notes.
        let notes = Suggestions.topNotes(from: sample, categoryId: "home", limit: 5)
        XCTAssertFalse(notes.isEmpty)
        XCTAssertTrue(notes.contains("Verdura"))
    }

    func testTopNotesEmptyWhenNoMatch() {
        XCTAssertTrue(Suggestions.topNotes(from: sample, categoryId: "coffee", matching: "zzz").isEmpty)
    }

    func testTopNotesIgnoresBlankNotes() {
        let notes = Suggestions.topNotes(from: sample, categoryId: "coffee", limit: 10)
        XCTAssertFalse(notes.contains(""))
    }
}
