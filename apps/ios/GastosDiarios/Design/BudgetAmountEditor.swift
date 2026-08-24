import SwiftUI

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
