import SwiftUI

/// The bank's pending USD charges, waiting to be matched to an expense.
///
/// A PANEL above the history, not a sheet behind a chip. It was the latter, and
/// the chip is easy not to notice — a charge nobody looks at is a purchase
/// missing from the ledger, which is the opposite of what this exists for. It
/// opens itself when something is waiting and collapses to one line when
/// nothing is, so the prominence costs the list nothing on a quiet day.
///
/// The Gmail ingestion (tools/gmail-bank-ingest) files one charge per
/// notification email; this screen proposes which expense each belongs to and
/// the user confirms. The matching itself is BankMatch, validated against the
/// same vectors as the web's — this file only shows it and writes the pair.
///
/// Suggestions are matched against the expenses already in memory (the current
/// and viewed periods), which is where a charge from the last day or two lands.
/// No extra reads.
struct BankChargesPanel: View {
    @Environment(AppModel.self) private var model

    /// Manual overrides, charge id → expense id.
    @State private var choice: [String: String] = [:]
    /// Collapsed by default: the discarded list is a safety net, not the job.
    @State private var showDismissed = false
    /// Set when a charge's icon is tapped: opens the rule sheet filled in.
    @State private var seedMerchant: String?
    /// The charge whose "Crear gasto" sheet is up.
    @State private var creatingFrom: BankCharge?
    /// Asking before confirming every guess at once. Assigning DELETES the
    /// charge, so a bulk mistake cannot be walked back the way a dismissal can.
    @State private var confirmingAll = false

    private var l10n: L10n { model.l10n }

    /// Open when something is waiting, closed when not — and once you have
    /// said which by hand, that wins. Nil means nobody has said.
    @State private var openedByHand: Bool?
    /// Past the first few, on request.
    @State private var showAll = false

    /// Two.
    ///
    /// Each card carries a figure, a subtitle, a picker, the rate it guessed
    /// at and three buttons, so it is tall. At three the history behind the
    /// panel started at the bottom edge of the screen; at two you can see the
    /// first day under it, which is what tells you there is a list at all.
    private static let visibleCards = 2

    private var isOpen: Bool {
        openedByHand ?? !model.expenseBankCharges.isEmpty
    }

    var body: some View {
        let pending = model.expenseBankCharges.count
        let dismissed = model.dismissedBankCharges.count
        if pending > 0 || dismissed > 0 {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    openedByHand = !isOpen
                } label: {
                    AdaptiveRow {
                        Text(l10n.bankChargesCount(pending))
                            .appFont(13.5, .bold)
                            .foregroundStyle(Theme.infoText)
                        AdaptiveGap()
                        Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                            .appFont(12, .semibold)
                            .foregroundStyle(Theme.inkTertiary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(Theme.infoBg)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    "\(l10n.bankChargesCount(pending)) — \(l10n.t(isOpen ? "bank.hide" : "bank.review"))"
                )

                if isOpen { list }
            }
            .sheet(item: Binding(
                get: { seedMerchant.map(SeedMerchant.init) },
                set: { seedMerchant = $0?.merchant }
            )) { seed in
                RecurringRuleSheet(rule: nil, seedMerchant: seed.merchant)
            }
            .sheet(item: $creatingFrom) { charge in
                CreateFromChargeSheet(charge: charge)
            }
            .alert(
                l10n.t("bank.confirmAllTitle"),
                isPresented: $confirmingAll
            ) {
                Button(l10n.t("common.cancel"), role: .cancel) {}
                Button(l10n.t("bank.confirmAllGo")) { confirmAll() }
            } message: {
                Text(l10n.t("bank.confirmAllBody", pendingGuesses.count))
            }
        }
    }


    /// Charge → expense for every card that currently HAS an answer on it.
    ///
    /// Exactly what is on screen, including anything picked by hand: this is
    /// the same set of taps in one press, not a second opinion with a rule of
    /// its own. A charge whose picker is empty — no candidate scored above
    /// BankMatch.minScore, or it was cleared deliberately — is not in here and
    /// is left for a person to answer.
    private var pendingGuesses: [(charge: BankCharge, expenseId: String)] {
        model.bankChargeSuggestions.compactMap { suggestion in
            guard
                let charge = model.expenseBankCharges
                    .first(where: { $0.id == suggestion.chargeId }),
                let expenseId = choice[charge.id] ?? suggestion.expenseId,
                !expenseId.isEmpty
            else { return nil }
            return (charge, expenseId)
        }
    }

    /// One press for the lot.
    ///
    /// Shown from TWO up. With a single charge the card's own button is right
    /// there and a second way to press it is noise.
    @ViewBuilder
    private var confirmAllButton: some View {
        let guesses = pendingGuesses
        if guesses.count >= 2 {
            Button {
                confirmingAll = true
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "checklist")
                        .font(.system(size: 14, weight: .semibold))
                    Text(l10n.t("bank.confirmAll", guesses.count))
                        .appFont(13.5, .bold)
                }
                .foregroundStyle(Theme.accentStrong)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Theme.accentSoft)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private func confirmAll() {
        let guesses = pendingGuesses
        guard !guesses.isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        for guess in guesses {
            model.assignBankCharge(guess.charge, to: guess.expenseId)
            choice[guess.charge.id] = nil
        }
    }

    private var list: some View {
        // No ScrollView: the history screen this sits in already scrolls, and
        // a scroll view inside another one traps the gesture.
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

                    // Above the cards, because it acts on all of them — and
                    // NOT in the toolbar beside Listo, for the same reason the
                    // ingest button is not: a press that cannot be undone does
                    // not belong next to the one that dismisses the screen.
                    confirmAllButton
                }

                // A couple, and then a way to see the rest.
                //
                // Open with five charges the panel filled the screen and the
                // history behind it could not be reached at all — prominence
                // that costs you the thing you came for is not prominence.
                let shown = showAll
                    ? model.bankChargeSuggestions
                    : Array(model.bankChargeSuggestions.prefix(Self.visibleCards))
                ForEach(shown, id: \.chargeId) { suggestion in
                    if let charge = model.expenseBankCharges.first(where: { $0.id == suggestion.chargeId }) {
                        card(charge: charge, suggestion: suggestion)
                    }
                }
                let hidden = model.bankChargeSuggestions.count - shown.count
                if hidden > 0 {
                    Button(l10n.t("bank.showRest", hidden)) { showAll = true }
                        .appFont(13, .semibold)
                        .foregroundStyle(Theme.accentStrong)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }

                dismissedSection
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
                // What the bank says, and the one action that is ABOUT the
                // charge rather than about this instance of it.
                //
                // Up here rather than in the action row below, where it sat a
                // thumb's width from Descartar — an irreversible-feeling press
                // beside a harmless one, which is how you discard a charge you
                // meant to make recurring. Making a rule is a settings act; it
                // does not belong in the row of answers.
                AdaptiveRow {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                            .appFont(20, .bold)
                            .monospacedDigit()
                            .foregroundStyle(Theme.ink)
                        Text(chargeSubtitle(charge))
                            .appFont(12)
                            .foregroundStyle(Theme.inkTertiary)
                    }
                    AdaptiveGap()
                    Button {
                        seedMerchant = charge.merchant
                    } label: {
                        Image(systemName: "arrow.trianglehead.clockwise")
                            .appFont(15, .semibold)
                            .padding(7)
                            .background(Theme.fill)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.inkSecondary)
                    // Named after its charge, because there is one of these per
                    // row: without it every button in the list is called
                    // "Hacerlo recurrente" and only the row says which.
                    .accessibilityLabel(
                        "\(l10n.t("recurring.fromCharge")) — \(charge.merchant.isEmpty ? MoneyFormatter.usd(charge.usdCents, locale: l10n.locale) : charge.merchant)"
                    )
                    .disabled(charge.merchant.isEmpty)
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
                    // The third way out. Before it, a charge with no
                    // counterpart could only be DISCARDED — which says "this
                    // was not ours" about a real purchase nobody had entered.
                    Button(l10n.t("bank.createExpense")) {
                        creatingFrom = charge
                    }
                    .appFont(13.5, .bold)
                    .foregroundStyle(Theme.accentStrong)
                    .accessibilityLabel(
                        "\(l10n.t("bank.createExpense")) — \(charge.merchant.isEmpty ? MoneyFormatter.usd(charge.usdCents, locale: l10n.locale) : charge.merchant)"
                    )

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

/// A merchant string as a sheet item.
///
/// `.sheet(item:)` needs Identifiable and a bare String is not — wrapping it
/// keeps the presentation tied to WHICH charge was tapped, so tapping a second
/// one while the first is open re-presents rather than silently doing nothing.
private struct SeedMerchant: Identifiable {
    let merchant: String
    var id: String { merchant }
}
