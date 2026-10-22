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
        /// Text that holds no amount this can read; carries the text verbatim.
        case unreadable(String)
    }

    /// An amount as Shortcuts hands it over: text.
    ///
    /// The action first took a currency amount, and Shortcuts could not turn
    /// the Transaction trigger's Amount into one — the first real tap, on
    /// 23/10/2026, arrived with the merchant and an EMPTY amount. Text is the
    /// one type Shortcuts can make of any variable, so the amount is read here
    /// instead: "$12.00", "A$12.00", "12.00 AUD", "AUD 12", "12,50",
    /// "1,234.56", "1.234,56". A currency code or symbol is kept so a foreign
    /// payment is refused rather than filed as AUD; "$" alone is the
    /// household's own currency, which is what an Australian card shows.
    static func parseAmount(_ raw: String) -> Result<(amount: Decimal, currencyCode: String), Refusal> {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let upper = text.uppercased()
        var code = ""
        if let match = upper.range(of: #"\b[A-Z]{3}\b"#, options: .regularExpression) {
            code = String(upper[match])
        } else if upper.contains("US$") {
            code = "USD"
        } else if upper.contains("A$") {
            code = "AUD"
        } else if upper.contains("€") {
            code = "EUR"
        } else if upper.contains("£") {
            code = "GBP"
        }
        let negative = text.contains("-") || text.contains("−") || (text.contains("(") && text.contains(")"))
        let number = text.filter { $0.isASCII && ($0.isNumber || $0 == "." || $0 == ",") }
        guard number.contains(where: \.isNumber) else { return .failure(.unreadable(raw)) }

        // Which mark is the decimal one. Both present: the last. Only one: a
        // decimal mark when it appears once with one or two digits after it,
        // otherwise thousands ("1,234", "1.050").
        let lastDot = number.lastIndex(of: "."), lastComma = number.lastIndex(of: ",")
        let decimalMark: Character?
        switch (lastDot, lastComma) {
        case let (dot?, comma?): decimalMark = dot > comma ? "." : ","
        case let (dot?, nil): decimalMark = isDecimal(number, at: dot) ? "." : nil
        case let (nil, comma?): decimalMark = isDecimal(number, at: comma) ? "," : nil
        case (nil, nil): decimalMark = nil
        }
        var plain = ""
        for character in number {
            if character.isNumber { plain.append(character) }
            else if character == decimalMark { plain.append(".") }
        }
        guard var value = Decimal(string: plain, locale: Locale(identifier: "en_US_POSIX")) else {
            return .failure(.unreadable(raw))
        }
        if negative { value = -value }
        return .success((value, code))
    }

    private static func isDecimal(_ number: String, at index: String.Index) -> Bool {
        let mark = number[index]
        let after = number[number.index(after: index)...]
        return number.filter { $0 == mark }.count == 1 && (1...2).contains(after.count)
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
