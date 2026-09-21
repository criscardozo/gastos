import SwiftUI

/// The bank's pending USD charges, as ROWS of the history list.
///
/// They were a panel above the list: its own blue header, a hint line and a
/// card per charge carrying a figure, a subtitle, a picker, the rate it guessed
/// at and three buttons. One charge cost about half the screen, and the whole
/// thing read as a second screen stapled to the top of this one — measured on
/// the phone, with a single charge pushing the first expense to the bottom
/// edge.
///
/// So a charge is now a row the same height and shape as an expense, in a
/// section of the same list, and the deciding happens in a sheet you open by
/// tapping it. What the panel was defending is kept: the section sits ABOVE the
/// days with its own header and count, because a charge nobody looks at is a
/// purchase missing from the ledger, and that was the reason it was never a
/// chip. Prominence is the position, not the height.
///
/// The Gmail ingestion (tools/gmail-bank-ingest) files one charge per
/// notification email; this proposes which expense each belongs to and the user
/// confirms. The matching itself is BankMatch, validated against the same
/// vectors as the web's — these views only show it and write the pair.

// MARK: Row

/// One charge, shaped like an expense row: circle, two lines, amount.
struct BankChargeRow: View {
    let charge: BankCharge
    let suggestion: BankMatch.Suggestion?
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize

    private var l10n: L10n { model.l10n }

    var body: some View {
        // Same rule as the expense row: side by side normally, stacked once the
        // text is big, because sharing the width left a single long merchant
        // name coming apart mid-word.
        let layout: AnyLayout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 11))
        return layout {
            Circle()
                .fill(Theme.infoBg)
                .frame(width: 38, height: 38)
                .overlay(
                    Image(systemName: "building.columns.fill")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.infoText)
                        // Decorative: the section header says these are the
                        // bank's, and the row's text says which.
                        .accessibilityHidden(true)
                )
            VStack(alignment: .leading, spacing: 1) {
                Text(BankChargeText.title(charge, l10n: l10n))
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
                // What it is going to be matched to, or that nothing was
                // found. This is the whole reason the row can be read without
                // opening it.
                Text(matchLine)
                    .appFont(12)
                    .foregroundStyle(suggestion?.expenseId == nil
                                     ? Theme.amberText
                                     : Theme.inkTertiary)
                    .lineLimit(1)
            }
            if !typeSize.isAccessibilitySize { Spacer() }
            HStack(spacing: 6) {
                Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                    .appFont(14.5, .bold)
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.inkTertiary)
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }

    private var matchLine: String {
        guard
            let expenseId = suggestion?.expenseId,
            let expense = model.unverifiedExpenses.first(where: { $0.id == expenseId })
        else { return l10n.t("bank.rowNoMatch") }
        return "→ \(BankChargeText.expenseLabel(expense, model: model, l10n: l10n))"
    }
}

// MARK: Sheet

/// Where a charge is answered: assign it, create the expense it belongs to, or
/// discard it.
///
/// This is the old card's content, given the room it always needed. The learned
/// rate travels with it — it is the reason the suggestion is any good, and it
/// belongs where the decision is made rather than as a line above a list.
struct BankChargeSheet: View {
    let charge: BankCharge
    let suggestion: BankMatch.Suggestion?
    let onDone: () -> Void

    @Environment(AppModel.self) private var model
    @State private var choice: String?
    @State private var seedMerchant: String?
    @State private var creating = false

    private var l10n: L10n { model.l10n }

    private var chosenId: String? {
        let id = choice ?? suggestion?.expenseId
        return (id?.isEmpty ?? true) ? nil : id
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(l10n.t("bank.title"))
                    .appFont(19, .bold)
                    .foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 22)

                header

                VStack(alignment: .leading, spacing: 8) {
                    Text(l10n.t("bank.chooseExpense"))
                        .appFont(11.5, .bold)
                        .foregroundStyle(Theme.inkTertiary)
                        .textCase(.uppercase)
                    if model.unverifiedExpenses.isEmpty {
                        Text(l10n.t("bank.noExpenses"))
                            .appFont(12.5)
                            .foregroundStyle(Theme.inkSecondary)
                    } else {
                        picker
                        Text(
                            suggestion?.expenseId == nil
                                ? l10n.t("bank.noCandidate")
                                : l10n.t(
                                    "bank.suggested",
                                    BankChargeText.rate(suggestion?.impliedRate ?? 0, l10n: l10n),
                                    Int(((suggestion?.score ?? 0) * 100).rounded())
                                )
                        )
                        .appFont(11.5, .semibold)
                        .foregroundStyle(Theme.inkTertiary)
                    }
                }

                // The rate the suggestions are built on, stated where the
                // suggestion is being judged.
                if let rate = model.learnedBankRate {
                    Text(l10n.t("bank.hintWithRate", BankChargeText.rate(rate, l10n: l10n)))
                        .appFont(11.5)
                        .foregroundStyle(Theme.inkTertiary)
                }

                PrimaryCTA(
                    title: l10n.t("bank.assign"),
                    icon: "checkmark",
                    height: 50,
                    enabled: chosenId != nil
                ) {
                    guard let expenseId = chosenId else { return }
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    model.assignBankCharge(charge, to: expenseId)
                    onDone()
                }

                // The third way out. Before it, a charge with no counterpart
                // could only be DISCARDED — which says "this was not ours"
                // about a real purchase nobody had entered.
                Button(l10n.t("bank.createExpense")) { creating = true }
                    .appFont(14, .bold)
                    .foregroundStyle(Theme.accentStrong)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)

                Button(l10n.t("bank.discard")) {
                    model.discardBankCharge(charge)
                    onDone()
                }
                .appFont(13.5, .semibold)
                .foregroundStyle(Theme.inkSecondary)
                .frame(maxWidth: .infinity)

                Button(l10n.t("common.cancel")) { onDone() }
                    .appFont(14, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Theme.bg.ignoresSafeArea())
        .sheet(item: Binding(
            get: { seedMerchant.map(SeedMerchant.init) },
            set: { seedMerchant = $0?.merchant }
        )) { seed in
            RecurringRuleSheet(rule: nil, seedMerchant: seed.merchant)
        }
        .sheet(isPresented: $creating) {
            CreateFromChargeSheet(charge: charge)
        }
    }

    private var header: some View {
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                    .appFont(26, .bold)
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)
                Text(BankChargeText.subtitle(charge, model: model, l10n: l10n))
                    .appFont(12.5)
                    .foregroundStyle(Theme.inkTertiary)
            }
            AdaptiveGap()
            // The one action that is ABOUT the charge rather than about this
            // instance of it. Away from Descartar on purpose: beside it, a
            // press meant to make something recurring lands on the one that
            // says it was never ours.
            Button {
                seedMerchant = charge.merchant
            } label: {
                Image(systemName: "arrow.trianglehead.clockwise")
                    .appFont(15, .semibold)
                    .padding(9)
                    .background(Theme.fill)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.inkSecondary)
            .accessibilityLabel(l10n.t("recurring.fromCharge"))
            .disabled(charge.merchant.isEmpty)
        }
    }

    private var picker: some View {
        Picker(
            selection: Binding(
                get: { chosenId ?? "" },
                set: { choice = $0 }
            )
        ) {
            Text(l10n.t("bank.none")).tag("")
            ForEach(model.unverifiedExpenses, id: \.id) { expense in
                Text(BankChargeText.expenseLabel(expense, model: model, l10n: l10n))
                    .tag(expense.id ?? "")
            }
        } label: {
            Text(l10n.t("bank.chooseExpense"))
        }
        .pickerStyle(.menu)
        .tint(Theme.ink)
        .labelsHidden()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Dismissed

/// What was discarded in the last 48 hours, and the way back.
///
/// Discarding is a single press with no confirmation, which is right — it is
/// the common case, and prompting every time would be worse. What makes that
/// safe is this list: a dismissal is a stamp, not a delete.
struct DismissedChargesSheet: View {
    let onDone: () -> Void
    @Environment(AppModel.self) private var model

    private var l10n: L10n { model.l10n }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(l10n.dismissedChargesCount(model.dismissedBankCharges.count))
                    .appFont(19, .bold)
                    .foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 22)
                    .padding(.bottom, 4)

                Text(l10n.t("bank.dismissedHint"))
                    .appFont(12)
                    .foregroundStyle(Theme.inkTertiary)
                ForEach(model.dismissedBankCharges, id: \.id) { charge in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                                .appFont(14.5, .bold)
                                .monospacedDigit()
                                .foregroundStyle(Theme.ink)
                            Text(BankChargeText.subtitle(charge, model: model, l10n: l10n))
                                .appFont(11.5)
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

                Button(l10n.t("common.close")) { onDone() }
                    .appFont(14, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(Theme.bg.ignoresSafeArea())
        // Restoring the last one closes this, and it has to be driven by the
        // count arriving rather than checked after the call: the write is not
        // awaited — Firestore only resolves it when the server confirms — so
        // reading the list on the next line still saw the charge that had just
        // been restored, and the sheet sat there saying "0 descartados".
        .onChange(of: model.dismissedBankCharges.count) { _, remaining in
            if remaining == 0 { onDone() }
        }
    }
}

// MARK: Labels

/// The strings a charge is shown with, in one place because the row, the sheet
/// and the dismissed list all say the same things about the same charge.
// Its two readers of `AppModel` — the household's categories and its timezone
// — are main-actor state, so the whole enum is, rather than each function
// carrying the annotation.
@MainActor
enum BankChargeText {
    /// "COLES 0831" — or the date when the bank sent no merchant at all.
    static func title(_ charge: BankCharge, l10n: L10n) -> String {
        charge.merchant.isEmpty
            ? MoneyFormatter.usd(charge.usdCents, locale: l10n.locale)
            : charge.merchant
    }

    /// "3 ago · COLES 0831 · ••1234"
    static func subtitle(_ charge: BankCharge, model: AppModel, l10n: L10n) -> String {
        var parts: [String] = []
        if let date = CalendarDate(charge.date) {
            parts.append(l10n.dayMonth(date, timeZone: model.householdTimeZone))
        }
        if !charge.merchant.isEmpty { parts.append(charge.merchant) }
        if let last4 = charge.cardLast4 { parts.append("••\(last4)") }
        return parts.joined(separator: " · ")
    }

    /// "Coles · $63,90 · 3 ago"
    static func expenseLabel(_ expense: Expense, model: AppModel, l10n: L10n) -> String {
        let category = model.household?.categories[expense.categoryId] ?? .missing
        let name = expense.note.isEmpty ? l10n.categoryName(category) : expense.note
        let amount = MoneyFormatter.aud(expense.amountCents, locale: l10n.locale)
        guard let date = CalendarDate(expense.date) else { return "\(name) · \(amount)" }
        return "\(name) · \(amount) · \(l10n.dayMonth(date, timeZone: model.householdTimeZone))"
    }

    /// "0,712" — three decimals is where a bank rate stops being noise.
    static func rate(_ rate: Double, l10n: L10n) -> String {
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
