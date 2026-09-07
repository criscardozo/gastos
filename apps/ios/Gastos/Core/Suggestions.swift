import Foundation

// MARK: - Quick-entry suggestions
// Pure, testable derivation of the note autocomplete from a set of expenses
// ALREADY loaded in memory (no extra Firestore reads).
// NO Firebase imports here — operates on plain `Expense` values.

enum Suggestions {

    /// Recency order for expenses: most recent `date` first, breaking ties by
    /// `createdAt`. Missing `createdAt` (still-pending local writes) sort last
    /// within their day.
    private static func recencySorted(_ expenses: [Expense]) -> [Expense] {
        expenses.sorted {
            ($0.date, $0.createdAt ?? .distantPast) > ($1.date, $1.createdAt ?? .distantPast)
        }
    }

    /// Up to `limit` note suggestions for autocomplete, ranked by frequency
    /// (most used first), ties broken by recency. Notes are trimmed; blanks are
    /// ignored. Matching is case/diacritic-insensitive: `query` filters to notes
    /// containing it (empty `query` returns the overall top notes). The original
    /// casing of the most recent occurrence is preserved for display.
    ///
    /// When `categoryId` is provided, notes from that category are preferred;
    /// if that yields nothing (thin per-category history) it falls back to the
    /// overall notes so the field is still helpful.
    static func topNotes(
        from expenses: [Expense],
        categoryId: String?,
        matching query: String = "",
        limit: Int = 3
    ) -> [String] {
        let scoped = rankedNotes(from: expenses, categoryId: categoryId, matching: query, limit: limit)
        if !scoped.isEmpty || categoryId == nil {
            return scoped
        }
        // Category had no matching notes — widen to all categories.
        return rankedNotes(from: expenses, categoryId: nil, matching: query, limit: limit)
    }

    private static func rankedNotes(
        from expenses: [Expense],
        categoryId: String?,
        matching query: String,
        limit: Int
    ) -> [String] {
        let needle = normalize(query)

        struct Entry {
            var display: String
            var count: Int
            var rank: Int  // recency index (lower = more recent)
        }
        var entries: [String: Entry] = [:]

        for (index, expense) in recencySorted(expenses).enumerated() {
            if let categoryId, expense.categoryId != categoryId { continue }
            let trimmed = expense.note.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            let folded = normalize(trimmed)
            if !needle.isEmpty, !folded.contains(needle) { continue }

            if var existing = entries[folded] {
                existing.count += 1
                entries[folded] = existing  // keep the most-recent display (first seen wins)
            } else {
                entries[folded] = Entry(display: trimmed, count: 1, rank: index)
            }
        }

        return entries.values
            .sorted { lhs, rhs in
                lhs.count == rhs.count ? lhs.rank < rhs.rank : lhs.count > rhs.count
            }
            .prefix(limit)
            .map(\.display)
    }

    /// Lowercased, diacritic-folded key for case/accent-insensitive matching.
    private static func normalize(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }
}
