import SwiftUI

/// Typing in what the BANK charged for an expense, in USD.
///
/// The card is paid in AUD but billed in USD at the bank's own rate, which
/// arrives by email afterwards. Until that figure is known the expense is
/// unverified; this sheet is how it gets known by hand (the Gmail ingestion
/// handles the rest, and its matching lives in the web app).
///
/// Nothing here touches the budget: `amountCents` is still the only figure any
/// total reads.
struct VerifyExpenseSheet: View {
    @Environment(AppModel.self) private var model
    let item: ExpenseItem
    var onDone: () -> Void

    @State private var input = AmountInput()
    @FocusState private var focused: Bool

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }
    private var category: Category {
        model.household?.categories[item.expense.categoryId] ?? .missing
    }

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 4) {
                Text(l10n.t("verify.title"))
                    .appFont(19, .bold)
                    .foregroundStyle(Theme.ink)
                Text(l10n.t("verify.subtitle"))
                    .appFont(13)
                    .foregroundStyle(Theme.inkSecondary)
            }
            .padding(.top, 22)

            // What is being verified: the expense, at its AUD amount.
            HStack(spacing: 11) {
                CategoryCircle(
                    categoryId: item.expense.categoryId,
                    category: category,
                    size: 34
                )
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.expense.note.isEmpty
                         ? l10n.categoryName(category)
                         : item.expense.note)
                        .appFont(14.5, .semibold)
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(MoneyFormatter.aud(item.expense.amountCents, locale: l10n.locale))
                        .appFont(12.5, .semibold)
                        .monospacedDigit()
                        .foregroundStyle(Theme.inkSecondary)
                }
                Spacer()
            }
            .padding(EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14))
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )

            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(verbatim: "US$")
                    .appFont(24, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
                TextField("0", text: amountText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.center)
                    .fixedSize()
                    .amountStyle(52, .bold)
                    .kerning(-0.03 * 52)
                    .foregroundStyle(Theme.ink)
                    .focused($focused)
            }
            .frame(maxHeight: .infinity)

            VStack(spacing: 10) {
                PrimaryCTA(
                    title: l10n.t("verify.save"),
                    height: 54,
                    enabled: input.cents > 0
                ) {
                    guard let id = item.expense.id, input.cents > 0 else { return }
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    model.setExpenseVerification(id: id, usdCents: input.cents)
                    onDone()
                }
                if item.expense.isVerified {
                    Button(l10n.t("verify.clear")) {
                        guard let id = item.expense.id else { return }
                        model.setExpenseVerification(id: id, usdCents: nil)
                        onDone()
                    }
                    .appFont(14, .semibold)
                    .foregroundStyle(Theme.redText)
                }
                Button(l10n.t("common.cancel")) { onDone() }
                    .appFont(14, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
            }
            .padding(.bottom, 10)
        }
        .padding(.horizontal, 20)
        .background(Theme.bg.ignoresSafeArea())
        .onAppear {
            // Editing an existing verification starts from its figure.
            if let cents = item.expense.usdCents {
                input = .fromCents(cents)
            }
        }
        // See ExpenseFormView for why this is `.task` and how it was checked.
        .task { focused = true }
    }

    /// Bridges the native decimal pad to the canonical `AmountInput`, exactly as
    /// the quick-entry hero amount does.
    private var amountText: Binding<String> {
        Binding(
            get: { input.editingText(separator: separator) },
            set: { input.setDisplay($0, separator: separator) }
        )
    }
}
