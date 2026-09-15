import SwiftUI

/// What the rules did while you were away, and what they still need.
///
/// Two halves, and only one is automatic. The charges a rule could price are
/// FILED before this appears and reported here; the ones it could not are asked
/// about, one at a time, and stay pending until answered. Nothing is filed on a
/// guess.
struct RecurringPromptSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    /// What was filed before the sheet came up, captured because the listener
    /// empties `recurringReady` the moment the writes land — reading it live
    /// would report zero.
    let filedCount: Int

    @State private var index = 0
    @State private var amount = BudgetEntryAmount()

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }
    private var asking: [AppModel.ClaimedCharge] { model.recurringAsking }
    private var current: AppModel.ClaimedCharge? {
        index < asking.count ? asking[index] : nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if filedCount > 0 {
                        Text(filedCount == 1
                             ? l10n.t("recurring.promptFiledOne")
                             : l10n.t("recurring.promptFiled", filedCount))
                            .appFont(13.5, .semibold)
                            .foregroundStyle(Theme.greenText)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.greenBg)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }

                    if let claim = current {
                        Card {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(claim.charge.merchant)
                                    .appFont(15, .bold)
                                    .foregroundStyle(Theme.ink)
                                Text(chargeLine(claim))
                                    .appFont(12)
                                    .foregroundStyle(Theme.inkSecondary)
                                Text(claim.rule.note)
                                    .appFont(12)
                                    .foregroundStyle(Theme.inkTertiary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 8)
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: l10n.t("recurring.promptAmount"))
                            HStack(spacing: 6) {
                                Text(verbatim: "$")
                                    .appFont(17, .semibold)
                                    .foregroundStyle(Theme.inkTertiary)
                                TextField("0,00", text: amountText)
                                    .appFont(17, .semibold)
                                    .keyboardType(.decimalPad)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(Theme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .strokeBorder(Theme.border, lineWidth: 1)
                            )
                        }

                        PrimaryCTA(
                            title: l10n.t("recurring.save"),
                            enabled: amount.audCents > 0
                        ) {
                            model.fileRecurring(claim, amountAudCents: amount.audCents)
                            amount = BudgetEntryAmount()
                            index += 1
                        }

                        if asking.count > 1 {
                            Text(verbatim: "\(index + 1)/\(asking.count)")
                                .appFont(11.5, .semibold)
                                .foregroundStyle(Theme.inkTertiary)
                                .frame(maxWidth: .infinity)
                        }
                    } else {
                        PrimaryCTA(title: l10n.t("recurring.promptDone"), icon: nil) {
                            dismiss()
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(l10n.t("recurring.promptTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    // "Later", not "cancel": what is left stays pending and the
                    // charges keep showing in Historial, so postponing loses
                    // nothing.
                    Button(l10n.t("recurring.promptLater")) { dismiss() }
                }
            }
        }
    }

    /// "US$ 12,40 · 5 sept" — and just the figure when the stored date is not
    /// a calendar date, rather than substituting today's and reading as a
    /// charge that arrived now.
    private func chargeLine(_ claim: AppModel.ClaimedCharge) -> String {
        let money = MoneyFormatter.usd(claim.charge.usdCents, locale: l10n.locale)
        guard let date = CalendarDate(claim.charge.date) else { return money }
        return "\(money) · \(l10n.dayMonth(date, timeZone: model.householdTimeZone))"
    }

    private var amountText: Binding<String> {
        Binding(
            get: { amount.input.editingText(separator: separator) },
            set: { amount.setDisplay($0, separator: separator) }
        )
    }
}
