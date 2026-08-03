import SwiftUI

// MARK: - Budget amount entry

/// Keypad amount for the budget editors. AUD is the only currency anyone types,
/// so this is a thin wrapper over `AmountInput` — kept as its own type because
/// the four editors (onboarding step 3, settings default amount, adjust-current
/// -period, new-period sheet) share it and only ever hand `audCents` to
/// Firestore.
struct BudgetEntryAmount: Equatable {
    var input = AmountInput()

    /// Integer cents to persist.
    var audCents: Int { input.cents }

    mutating func tap(_ key: KeypadKey) {
        input.tap(key)
    }

    /// Fills an amount (e.g. a recent-amount quick-fill chip).
    mutating func setAUDCents(_ cents: Int) {
        input = .fromCents(cents)
    }

    static func fromAUDCents(_ cents: Int) -> BudgetEntryAmount {
        var value = BudgetEntryAmount()
        value.input = .fromCents(cents)
        return value
    }
}

/// Shared amount display for the four budget editors: the big tabular amount
/// with its "$" symbol. The keypad and the save CTA stay screen-specific.
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
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("$")
                .appFont(symbolSize, .semibold)
                .foregroundStyle(Theme.inkTertiary)
            Text(value.input.display(separator: separator))
                .amountStyle(fontSize, .bold)
                .kerning(-0.03 * fontSize)
                .foregroundStyle(Theme.ink)
            if showsCurrencyCode {
                Text(model.household?.currency ?? "AUD")
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
    }
}
