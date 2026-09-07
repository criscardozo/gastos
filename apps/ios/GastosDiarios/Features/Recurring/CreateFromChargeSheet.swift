import SwiftUI

/// Turn a charge into a NEW expense, rather than matching it to one.
///
/// The third way out of the pending list. Before this a charge with no
/// counterpart could only be discarded, which is the wrong answer for a real
/// purchase nobody had entered: discarding says "this was not ours".
///
/// The AUD is pre-filled from the rate the household's own verified pairs
/// reveal, because the bank only ever says USD and the ledger only ever holds
/// AUD. Pre-filled and editable, not filed silently: the figure is a division
/// until somebody looks at it, and looking at it is this sheet.
struct CreateFromChargeSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let charge: BankCharge

    @State private var amount = BudgetEntryAmount()
    @State private var note = ""
    @State private var categoryId = ""

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // What the bank said, which is the whole reason this is here.
                    Card {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                                .appFont(20, .bold)
                                .monospacedDigit()
                                .foregroundStyle(Theme.ink)
                            Text(subtitle)
                                .appFont(12)
                                .foregroundStyle(Theme.inkTertiary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(text: l10n.t("bank.audAmount"))
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
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Theme.border, lineWidth: 1)
                        )
                        if let rate = model.learnedBankRate {
                            Text(l10n.t("bank.audFromRate", rateText(rate)))
                                .appFont(11.5)
                                .foregroundStyle(Theme.inkTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(text: l10n.t("bank.note"))
                        TextField("", text: $note)
                            .appFont(15)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .background(Theme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .strokeBorder(Theme.border, lineWidth: 1)
                            )
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(text: l10n.t("bank.category"))
                        Picker(l10n.t("bank.category"), selection: $categoryId) {
                            ForEach(sortedCategories, id: \.0) { id, category in
                                Text(name(of: category, id: id)).tag(id)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(Theme.ink)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Theme.border, lineWidth: 1)
                        )
                    }

                    PrimaryCTA(
                        title: l10n.t("bank.createExpense"),
                        enabled: amount.audCents > 0 && !trimmedNote.isEmpty
                    ) {
                        model.createExpenseFromCharge(
                            charge,
                            categoryId: categoryId,
                            note: trimmedNote,
                            amountAudCents: amount.audCents
                        )
                        dismiss()
                    }
                }
                .padding(20)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(l10n.t("bank.createExpense"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(l10n.t("common.cancel")) { dismiss() }
                }
            }
        }
        .onAppear(perform: load)
    }

    // MARK: Pieces

    private var trimmedNote: String {
        note.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var subtitle: String {
        guard let date = CalendarDate(charge.date) else { return charge.merchant }
        let day = l10n.dayMonth(date, timeZone: model.householdTimeZone)
        return charge.merchant.isEmpty ? day : "\(day) · \(charge.merchant)"
    }

    private var sortedCategories: [(String, Category)] {
        (model.household?.categories ?? [:])
            .sorted { $0.value.sortOrder < $1.value.sortOrder }
            .map { ($0.key, $0.value) }
    }

    private func name(of category: Category, id: String) -> String {
        let name = l10n.categoryName(category)
        return name.isEmpty ? id : name
    }

    private func rateText(_ rate: Double) -> String {
        String(format: "%.4f", rate)
            .replacingOccurrences(of: ".", with: separator)
    }

    private var amountText: Binding<String> {
        Binding(
            get: { amount.input.editingText(separator: separator) },
            set: { amount.setDisplay($0, separator: separator) }
        )
    }

    private func load() {
        guard note.isEmpty else { return }
        // Title-cased: the bank shouts and a ledger should not.
        note = charge.merchant
            .lowercased()
            .split(separator: " ", omittingEmptySubsequences: false)
            .map { $0.isEmpty ? "" : $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
        categoryId = sortedCategories.first?.0 ?? ""
        if let estimate = RecurringRules.estimateAudCents(
            usdCents: charge.usdCents, rate: model.learnedBankRate
        ) {
            amount.setAUDCents(estimate)
        }
    }
}
