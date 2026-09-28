import Foundation

/// A string that changes exactly when the figures of a set of expenses do.
///
/// What the month's server-side sum is refreshed on. It keys on what the sum
/// reads — which expenses, their amount, their date (a date can move an
/// expense out of the month) and their category (a category can stop
/// counting) — and on nothing else, so the pending-write and acknowledged
/// snapshots of one expense cost a single read between them. Sorted, so the
/// order a listener delivers in is not a change. The web's twin is
/// `ledgerSignature` in apps/web/src/lib/ledger-signature.ts.
enum LedgerSignature {
    static func of(_ expenses: [Expense]) -> String {
        expenses
            .map { "\($0.id ?? ""):\($0.amountCents):\($0.date):\($0.categoryId)" }
            .sorted()
            .joined(separator: "|")
    }
}
