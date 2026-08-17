import SwiftUI

/// The bank's pending USD charges, waiting to be matched to an expense.
///
/// The Gmail ingestion (tools/gmail-bank-ingest) files one charge per
/// notification email; this screen proposes which expense each belongs to and
/// the user confirms. The matching itself is BankMatch, validated against the
/// same vectors as the web's — this file only shows it and writes the pair.
///
/// Suggestions are matched against the expenses already in memory (the current
/// and viewed periods), which is where a charge from the last day or two lands.
/// No extra reads.
struct BankChargesSheet: View {
    @Environment(AppModel.self) private var model
    var onDone: () -> Void

    /// Manual overrides, charge id → expense id.
    @State private var choice: [String: String] = [:]
    /// Collapsed by default: the discarded list is a safety net, not the job.
    @State private var showDismissed = false

    private var l10n: L10n { model.l10n }

    var body: some View {
        NavigationStack {
            Group {
                if model.expenseBankCharges.isEmpty && model.dismissedBankCharges.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(l10n.t("bank.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(l10n.t("common.done")) { onDone() }
                        .appFont(15, .semibold)
                }
            }
        }
    }

    // MARK: Pieces

    private var list: some View {
        ScrollView {
            VStack(spacing: 12) {
                if !model.expenseBankCharges.isEmpty {
                    // The learned rate is the reason the suggestions are any
                    // good, so it is stated rather than hidden behind them.
                    Text(
                        model.learnedBankRate.map {
                            l10n.t("bank.hintWithRate", rateText($0))
                        } ?? l10n.t("bank.hint")
                    )
                    .appFont(12)
                    .foregroundStyle(Theme.inkTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                ForEach(model.bankChargeSuggestions, id: \.chargeId) { suggestion in
                    if let charge = model.expenseBankCharges.first(where: { $0.id == suggestion.chargeId }) {
                        card(charge: charge, suggestion: suggestion)
                    }
                }

                dismissedSection
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 28)
        }
    }

    /// What was discarded in the last 48 hours, and the way back.
    ///
    /// Discarding is a single press with no confirmation, which is right — it is
    /// the common case, and prompting every time would be worse. What makes that
    /// safe is this list: a dismissal is a stamp, not a delete.
    @ViewBuilder
    private var dismissedSection: some View {
        let dismissed = model.dismissedBankCharges
        if !dismissed.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                DisclosureGroup(isExpanded: $showDismissed) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(l10n.t("bank.dismissedHint"))
                            .appFont(11.5)
                            .foregroundStyle(Theme.inkTertiary)
                        ForEach(dismissed, id: \.id) { charge in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                                        .appFont(14, .bold)
                                        .monospacedDigit()
                                        .foregroundStyle(Theme.inkSecondary)
                                    Text(chargeSubtitle(charge))
                                        .appFont(11)
                                        .foregroundStyle(Theme.inkTertiary)
                                }
                                Spacer()
                                Button(l10n.t("bank.restore")) {
                                    model.restoreBankCharge(charge)
                                }
                                .appFont(12.5, .bold)
                                .foregroundStyle(Theme.ink)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Theme.fill)
                                .clipShape(Capsule())
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Text(l10n.dismissedChargesCount(dismissed.count))
                        .appFont(12.5, .semibold)
                        .foregroundStyle(Theme.inkSecondary)
                }
                .tint(Theme.inkTertiary)
            }
            .padding(.top, 4)
        }
    }

    private func card(charge: BankCharge, suggestion: BankMatch.Suggestion) -> some View {
        let chosenId = choice[charge.id] ?? suggestion.expenseId
        let chosen = model.unverifiedExpenses.first { $0.id == chosenId }
        return Card(padding: EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16)) {
            VStack(alignment: .leading, spacing: 12) {
                // What the bank says.
                VStack(alignment: .leading, spacing: 2) {
                    Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                        .appFont(20, .bold)
                        .monospacedDigit()
                        .foregroundStyle(Theme.ink)
                    Text(chargeSubtitle(charge))
                        .appFont(12)
                        .foregroundStyle(Theme.inkTertiary)
                }

                Divider().overlay(Theme.separator)

                // Which expense it is being matched to.
                if model.unverifiedExpenses.isEmpty {
                    Text(l10n.t("bank.noExpenses"))
                        .appFont(12.5)
                        .foregroundStyle(Theme.inkSecondary)
                } else {
                    Picker(
                        selection: Binding(
                            get: { chosenId ?? "" },
                            set: { choice[charge.id] = $0 }
                        )
                    ) {
                        Text(l10n.t("bank.none")).tag("")
                        ForEach(model.unverifiedExpenses, id: \.id) { expense in
                            Text(expenseLabel(expense)).tag(expense.id ?? "")
                        }
                    } label: {
                        Text(l10n.t("bank.chooseExpense"))
                    }
                    .pickerStyle(.menu)
                    .tint(Theme.ink)
                    .labelsHidden()
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Text(
                        suggestion.expenseId == nil
                            ? l10n.t("bank.noCandidate")
                            : l10n.t(
                                "bank.suggested",
                                rateText(suggestion.impliedRate ?? 0),
                                Int((suggestion.score * 100).rounded())
                            )
                    )
                    .appFont(11.5, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
                }

                HStack(spacing: 12) {
                    PrimaryCTA(
                        title: l10n.t("bank.assign"),
                        icon: "checkmark",
                        height: 46,
                        enabled: chosen?.id != nil
                    ) {
                        guard let expenseId = chosen?.id else { return }
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        model.assignBankCharge(charge, to: expenseId)
                        choice[charge.id] = nil
                    }
                    Button(l10n.t("bank.discard")) {
                        model.discardBankCharge(charge)
                    }
                    .appFont(13.5, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 34))
                .foregroundStyle(Theme.greenText)
            Text(l10n.t("bank.empty"))
                .appFont(15, .semibold)
                .foregroundStyle(Theme.ink)
            Text(l10n.t("bank.emptyFoot"))
                .appFont(12.5)
                .foregroundStyle(Theme.inkTertiary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Labels

    /// "3 ago · COLES 0831 · ••1234"
    private func chargeSubtitle(_ charge: BankCharge) -> String {
        var parts: [String] = []
        if let date = CalendarDate(charge.date) {
            parts.append(l10n.dayMonth(date, timeZone: model.householdTimeZone))
        }
        if !charge.merchant.isEmpty { parts.append(charge.merchant) }
        if let last4 = charge.cardLast4 { parts.append("••\(last4)") }
        return parts.joined(separator: " · ")
    }

    /// "Coles · $63,90 · 3 ago"
    private func expenseLabel(_ expense: Expense) -> String {
        let category = model.household?.categories[expense.categoryId] ?? .missing
        let name = expense.note.isEmpty ? l10n.categoryName(category) : expense.note
        let amount = MoneyFormatter.aud(expense.amountCents, locale: l10n.locale)
        guard let date = CalendarDate(expense.date) else { return "\(name) · \(amount)" }
        return "\(name) · \(amount) · \(l10n.dayMonth(date, timeZone: model.householdTimeZone))"
    }

    /// "0,712" — three decimals is where a bank rate stops being noise.
    private func rateText(_ rate: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = l10n.locale
        formatter.minimumFractionDigits = 3
        formatter.maximumFractionDigits = 3
        return formatter.string(from: NSNumber(value: rate)) ?? "—"
    }
}
