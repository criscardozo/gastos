import SwiftUI

/// Add or edit a recurring-expense rule.
///
/// The field worth explaining is the amount, and the explanation is that
/// LEAVING IT OUT IS A CHOICE: a rule with an amount files the charge on its
/// own, one without can only annotate it and ask. The two do different things,
/// so the control is a two-way pill rather than an optional text field.
struct RecurringRuleSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    /// Nil when adding.
    let rule: RecurringRuleDoc?
    /// Pre-fill from the charge this was opened over, when it was.
    var seedMerchant: String?

    @State private var pattern = ""
    @State private var note = ""
    @State private var categoryId = ""
    @State private var asks = true
    @State private var amount = BudgetEntryAmount()
    @State private var confirmDelete = false

    private var l10n: L10n { model.l10n }
    /// Same rule the entry form uses: the app's language, not the device's.
    private var separator: String { l10n.language == "en" ? "." : "," }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    field(l10n.t("recurring.pattern"), help: l10n.t("recurring.patternHelp")) {
                        TextField("Opal*", text: $pattern)
                            .appFont(15)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.characters)
                    }

                    // Live, because a pattern you cannot try is a guess you
                    // find out about days later.
                    Text(matchSummary)
                        .appFont(11.5, .semibold)
                        .foregroundStyle(Theme.inkSecondary)

                    field(l10n.t("recurring.note")) {
                        TextField("Opal", text: $note)
                            .appFont(15)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(text: l10n.t("recurring.category"))
                        categoryPicker
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(text: l10n.t("recurring.amount"))
                        SegmentedPill(
                            options: [
                                (false, l10n.t("recurring.amount")),
                                (true, l10n.t("recurring.amountAsk")),
                            ],
                            selection: $asks
                        )
                        if !asks {
                            // A plain decimal field, not the entry screen's
                            // custom keypad: this is a setting typed once, not
                            // an amount typed at a till.
                            HStack(spacing: 6) {
                                Text(verbatim: "$")
                                    .appFont(15, .semibold)
                                    .foregroundStyle(Theme.inkTertiary)
                                TextField("0,00", text: amountText)
                                    .appFont(15, .semibold)
                                    .keyboardType(.decimalPad)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .background(Theme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .strokeBorder(Theme.border, lineWidth: 1)
                            )
                        }
                        Text(l10n.t("recurring.amountHelp"))
                            .appFont(11.5)
                            .foregroundStyle(Theme.inkTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    PrimaryCTA(title: l10n.t("recurring.save"), enabled: isValid) {
                        save()
                    }

                    if let rule {
                        Button(role: .destructive) {
                            if confirmDelete {
                                model.deleteRecurringRule(rule.id)
                                dismiss()
                            } else {
                                confirmDelete = true
                            }
                        } label: {
                            Text(confirmDelete
                                 ? l10n.t("recurring.deleteConfirm")
                                 : l10n.t("recurring.delete"))
                                .appFont(14, .semibold)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.red)
                    }
                }
                .padding(20)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(l10n.t("recurring.title"))
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

    @ViewBuilder
    private func field(
        _ title: String,
        help: String? = nil,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: title)
            content()
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Theme.border, lineWidth: 1)
                )
            if let help {
                Text(help)
                    .appFont(11.5)
                    .foregroundStyle(Theme.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var categoryPicker: some View {
        Picker(l10n.t("recurring.category"), selection: $categoryId) {
            ForEach(sortedCategories, id: \.0) { id, category in
                Text(categoryName(id: id, category: category)).tag(id)
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

    private var sortedCategories: [(String, Category)] {
        (model.household?.categories ?? [:])
            .sorted { $0.value.sortOrder < $1.value.sortOrder }
            .map { ($0.key, $0.value) }
    }

    /// The display rule lives in `L10n.categoryName`, which prefixes the key
    /// with `category.` — a second copy here passed the bare key, so `t("transport")`
    /// fell through to its own fallback and the picker listed raw ids.
    private func categoryName(id: String, category: Category) -> String {
        let name = l10n.categoryName(category)
        return name.isEmpty ? id : name
    }

    /// What the pattern would claim right now, out of the charges waiting.
    private var matchSummary: String {
        let trimmed = pattern.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return " " }
        let hits = model.expenseBankCharges.filter {
            RecurringRules.matches(pattern: trimmed, merchant: $0.merchant)
        }
        return hits.isEmpty
            ? l10n.t("recurring.matchesNone")
            : l10n.t("recurring.matches", hits.count)
    }

    /// Bridges the field to the canonical amount model, which caps at the
    /// ceiling the rules enforce.
    private var amountText: Binding<String> {
        Binding(
            get: { amount.input.editingText(separator: separator) },
            set: { amount.setDisplay($0, separator: separator) }
        )
    }

    private var isValid: Bool {
        !pattern.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !categoryId.isEmpty
            && (asks || amount.audCents > 0)
    }

    private func load() {
        guard pattern.isEmpty, note.isEmpty else { return }
        // The whole merchant, not a guess at the stem. "OPAL AUCKLAND ST" is
        // too specific to be a good rule, but it is RIGHT, and trimming it is a
        // one-second edit — whereas a clever guess that drops the wrong half is
        // a rule that never fires and says nothing about why.
        pattern = rule?.pattern ?? seedMerchant ?? ""
        // The note is what shows in Historial, so it is title-cased: the bank
        // shouts and a ledger should not. The PATTERN stays exactly as the
        // bank writes it, because that one has to match.
        note = rule?.note ?? seedMerchant.map(Self.titleCased) ?? ""
        categoryId = rule?.categoryId ?? sortedCategories.first?.0 ?? ""
        asks = rule?.amountAudCents == nil
        if let cents = rule?.amountAudCents { amount.setAUDCents(cents) }
    }

    /// "OPAL AUCKLAND ST" → "Opal Auckland St".
    private static func titleCased(_ text: String) -> String {
        text.lowercased()
            .split(separator: " ", omittingEmptySubsequences: false)
            .map { $0.isEmpty ? "" : $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    private func save() {
        let cents = asks ? nil : amount.audCents
        if let rule {
            model.updateRecurringRule(
                rule.id, pattern: pattern, categoryId: categoryId,
                note: note, amountAudCents: cents
            )
            dismiss()
        } else {
            // Saved AND applied: the icon that opens this sits on a pending
            // charge, so that charge is the whole reason the rule exists.
            let (p, c, n) = (pattern, categoryId, note)
            Task { @MainActor in
                await model.addRecurringRuleAndApply(
                    pattern: p, categoryId: c, note: n, amountAudCents: cents
                )
            }
            dismiss()
        }
    }
}
