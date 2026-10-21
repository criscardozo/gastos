import Foundation

/// A Wallet payment turned into an expense, with nobody looking.
///
/// Shortcuts' "Transaction" automation fires when a Wallet card is tapped and
/// hands over the amount, the merchant and the card; `LogPaymentIntent` runs
/// from it and saves the expense without opening the app. Which cards count is
/// chosen in the automation itself, so nothing here filters by card.
///
/// Everything a person would have decided in the entry form is decided here
/// instead, from what the household already did — so it is pure and tested,
/// and the intent around it is only I/O.
enum WalletPayment {
    enum Refusal: Error, Equatable {
        /// Paid in another currency. The ledger is AUD only and converts
        /// nothing, so a foreign amount cannot be filed as if it were AUD.
        case foreignCurrency(String)
        /// Zero or negative: a refund or a card check, not a spend.
        case notASpend
        /// Past the ceiling the rules enforce.
        case tooLarge
        /// The household has no category an expense may go in.
        case noCategory
    }

    /// The amount in household cents. An empty currency code is taken as the
    /// household's: Shortcuts can hand over a bare number.
    static func amountCents(
        _ amount: Decimal, currencyCode: String, householdCurrency: String
    ) -> Result<Int, Refusal> {
        let code = currencyCode.trimmingCharacters(in: .whitespaces).uppercased()
        if !code.isEmpty, code != householdCurrency.uppercased() {
            return .failure(.foreignCurrency(code))
        }
        var cents = amount * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &cents, 0, .plain)
        let value = NSDecimalNumber(decimal: rounded).intValue
        guard value > 0 else { return .failure(.notASpend) }
        guard value <= Limits.maxExpenseAmountCents else { return .failure(.tooLarge) }
        return .success(value)
    }

    /// Payment processors that prefix the merchant's own name. Stripped so the
    /// note reads as the shop and matches what was typed for it before.
    private static let processorPrefixes = ["SQ *", "SQ*", "ZLR*", "SP *", "LS "]

    /// The note: the merchant, without a processor prefix, in display case.
    static func note(forMerchant raw: String) -> String {
        var merchant = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        for prefix in processorPrefixes where merchant.uppercased().hasPrefix(prefix) {
            merchant = String(merchant.dropFirst(prefix.count))
                .trimmingCharacters(in: .whitespaces)
            break
        }
        return String(MerchantName.display(merchant).prefix(Limits.maxNoteCharacters))
    }

    /// The category: whatever the most recent expense with this same note was
    /// put in, while that category still takes new expenses; otherwise
    /// "other", the seed category for exactly this; otherwise the first one a
    /// form would offer.
    static func categoryId(
        forNote note: String, expenses: [Expense], categories: [String: Category]
    ) -> Result<String, Refusal> {
        let offered = Category.entryOrder(categories).map(\.id)
        let needle = fold(note)
        if !needle.isEmpty {
            let previous = expenses
                .filter { fold($0.note) == needle && offered.contains($0.categoryId) }
                .max { ($0.date, $0.createdAt ?? .distantPast) < ($1.date, $1.createdAt ?? .distantPast) }
            if let previous { return .success(previous.categoryId) }
        }
        if let other = offered.first(where: { categories[$0]?.key == "other" }) {
            return .success(other)
        }
        return offered.first.map { .success($0) } ?? .failure(.noCategory)
    }

    private static func fold(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }
}
