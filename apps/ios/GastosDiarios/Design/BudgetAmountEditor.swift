import SwiftUI

// MARK: - Bi-currency budget entry

/// Currency the user is typing a budget amount in. Transient UI state only —
/// whatever the entry currency, the persisted value is ALWAYS AUD integer
/// cents; the Firestore contract never changes.
enum BudgetEntryCurrency: String {
    case aud = "AUD"
    case usd = "USD"
}

/// Keypad amount + entry currency + the daily AUD→USD rate. `audCents` is the
/// only value that ever leaves this struct towards Firestore.
struct BudgetEntryAmount: Equatable {
    var input = AmountInput()
    var currency: BudgetEntryCurrency = .aud
    /// Cached daily AUD→USD rate. nil (offline with an empty cache) hides the
    /// USD option entirely and the editors behave exactly as AUD-only.
    var rate: Double?

    /// AUD integer cents to persist. USD input is converted with the daily
    /// rate and rounded to the nearest cent.
    var audCents: Int {
        switch currency {
        case .aud:
            return input.cents
        case .usd:
            guard let rate, rate > 0 else { return input.cents }
            return Int((Double(input.cents) / rate).rounded())
        }
    }

    /// Flips the entry currency, re-expressing the typed value so the
    /// effective budget stays (approximately) the same.
    mutating func switchTo(_ newCurrency: BudgetEntryCurrency) {
        guard newCurrency != currency else { return }
        guard let rate, rate > 0 else {
            currency = .aud
            return
        }
        let cents = input.cents
        if cents > 0 {
            let converted = newCurrency == .usd
                ? Int((Double(cents) * rate).rounded())
                : Int((Double(cents) / rate).rounded())
            input = .fromCents(converted)
        }
        currency = newCurrency
    }

    mutating func tap(_ key: KeypadKey) {
        input.tap(key)
    }

    static func fromAUDCents(_ cents: Int) -> BudgetEntryAmount {
        var value = BudgetEntryAmount()
        value.input = .fromCents(cents)
        return value
    }
}

/// Shared amount display for the four budget editors (onboarding step 3,
/// settings default amount, adjust-current-period, new-period sheet): the big
/// tabular amount plus a small AUD|USD toggle and a muted approximate
/// conversion line. The keypad and the save CTA stay screen-specific.
/// Without an FX rate it renders exactly the pre-existing AUD-only row.
struct BudgetAmountEditor: View {
    @Environment(AppModel.self) private var model
    @Binding var value: BudgetEntryAmount
    var fontSize: CGFloat = 46
    var symbolSize: CGFloat = 22
    var showsCurrencyCode = true
    var showsEditIcon = false

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }

    var body: some View {
        VStack(spacing: 10) {
            if value.rate != nil {
                SegmentedPill(
                    options: [
                        (BudgetEntryCurrency.aud, "AUD"),
                        (BudgetEntryCurrency.usd, "USD"),
                    ],
                    selection: Binding(
                        get: { value.currency },
                        set: { value.switchTo($0) }
                    )
                )
                .fixedSize()
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value.currency == .usd ? "US$" : "$")
                    .appFont(symbolSize, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
                Text(value.input.display(separator: separator))
                    .amountStyle(fontSize, .bold)
                    .kerning(-0.03 * fontSize)
                    .foregroundStyle(Theme.ink)
                if showsCurrencyCode {
                    Text(value.currency.rawValue)
                        .appFont(15, .semibold)
                        .foregroundStyle(Theme.inkTertiary)
                        .padding(.leading, 4)
                }
                if showsEditIcon {
                    Image(systemName: "pencil")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.inkTertiary)
                        .padding(.leading, 6)
                }
            }

            if let approx = approxText {
                Text(approx)
                    .appFont(13, .semibold)
                    .monospacedDigit()
                    .foregroundStyle(Theme.inkTertiary)
            }
        }
        .task {
            guard value.rate == nil else { return }
            value.rate = await model.budgetEntryUSDRate()
        }
    }

    /// "≈ US$ 588,60" while typing AUD; "≈ $1.375,00 AUD" while typing USD.
    private var approxText: String? {
        guard let rate = value.rate, rate > 0 else { return nil }
        switch value.currency {
        case .aud:
            return MoneyFormatter.approxUSD(audCents: value.input.cents, rate: rate, locale: l10n.locale)
        case .usd:
            return MoneyFormatter.approxAUD(value.audCents, locale: l10n.locale)
        }
    }
}
