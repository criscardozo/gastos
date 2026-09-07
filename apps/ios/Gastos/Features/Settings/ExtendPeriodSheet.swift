import SwiftUI

/// Stretching the week under way into two weeks.
///
/// The household budgets Friday to Thursday. A few days in, it can become clear
/// that this one has to cover a fortnight — so the period keeps its start, its
/// end moves out by a week, and a second week's budget is added on top of
/// whatever is already there (including anything carried over at the start,
/// which is left exactly as it was: that figure records what came IN).
///
/// This is ONE-WAY. Nothing walks a fortnight back to a week — not this screen,
/// not the security rules — which is why confirming is a second, deliberate
/// press rather than a checkbox.
///
/// The web twin is apps/web/src/components/extend-period-dialog.tsx; the date
/// arithmetic is `PeriodLogic.extendToFortnight`, validated on both platforms
/// against shared/period-test-vectors.json.
struct ExtendPeriodSheet: View {
    @Environment(AppModel.self) private var model
    let period: PeriodBudget
    var onDone: () -> Void

    /// What is being added for the second week, in the app's canonical
    /// typed-amount model — the same one quick entry and verification use.
    @State private var input = AmountInput()
    /// The second press. Nothing is written until this is true.
    @State private var confirming = false
    @FocusState private var focused: Bool

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }

    private var addedCents: Int { input.cents }
    private var newTotalCents: Int { period.amountCents + addedCents }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    dates
                    amountField
                    if addedCents > 0 { total }
                    if confirming { warning }
                    cta
                }
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 28)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(l10n.t("extendPeriod.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(l10n.t("common.cancel")) { onDone() }
                }
            }
        }
        .onAppear {
            // Prefilled with the household's default budget — what a second
            // week normally costs — but editable, which is the whole point.
            if input.isEmpty, let amount = model.household?.defaultBudget.amountCents {
                input = .fromCents(amount)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { focused = true }
        }
    }

    // MARK: Pieces

    /// Before and after, because the dates ARE the change.
    private var dates: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let end = period.end {
                HStack {
                    Text(l10n.t("extendPeriod.endsNow"))
                        .appFont(12)
                        .foregroundStyle(Theme.inkSecondary)
                    Spacer()
                    Text(l10n.longDate(end, timeZone: model.householdTimeZone))
                        .appFont(13, .semibold)
                        .foregroundStyle(Theme.inkSecondary)
                        .strikethrough()
                }
            }
            if let extended = model.extendedEndDate {
                HStack {
                    Text(l10n.t("extendPeriod.endsAfter"))
                        .appFont(12, .semibold)
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    Text(l10n.longDate(extended, timeZone: model.householdTimeZone))
                        .appFont(13.5, .bold)
                        .foregroundStyle(Theme.ink)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.fill)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var amountField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l10n.t("extendPeriod.addAmount"))
                .appFont(11, .bold)
                .kerning(0.7)
                .textCase(.uppercase)
                .foregroundStyle(Theme.inkTertiary)
            TextField("", text: amountText)
                .keyboardType(.decimalPad)
                .focused($focused)
                .appFont(17, .semibold)
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Theme.border, lineWidth: 1)
                )
            Text(l10n.t("extendPeriod.addAmountHelp"))
                .appFont(11.5)
                .foregroundStyle(Theme.inkTertiary)
        }
    }

    private var total: some View {
        HStack {
            Text(l10n.t("extendPeriod.newTotal"))
                .appFont(13, .semibold)
                .foregroundStyle(Theme.ink)
            Spacer()
            Text(MoneyFormatter.aud(newTotalCents, locale: l10n.locale))
                .appFont(18, .bold)
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
        }
        .padding(.top, 2)
    }

    private var warning: some View {
        Text(l10n.t("extendPeriod.noWayBack"))
            .appFont(12.5, .semibold)
            .foregroundStyle(Theme.amberText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Theme.amberBg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    /// Not `PrimaryCTA`: this button has to turn amber on the second press, and
    /// that component is accent-coloured by design.
    private var cta: some View {
        Button {
            guard addedCents > 0 else { return }
            if !confirming {
                confirming = true
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                return
            }
            focused = false
            model.extendCurrentPeriod(addedCents: addedCents)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onDone()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: confirming
                      ? "exclamationmark.triangle.fill"
                      : "calendar.badge.plus")
                    .font(.system(size: 16, weight: .bold))
                Text(l10n.t(confirming ? "extendPeriod.confirm" : "extendPeriod.extend"))
                    .appFont(16, .bold)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(confirming ? Theme.amberText : Theme.accent)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(addedCents <= 0)
        .opacity(addedCents > 0 ? 1 : 0.45)
    }

    /// Bridges the native decimal pad to the canonical `AmountInput`, exactly as
    /// quick entry and the verification sheet do. Editing the figure withdraws
    /// the confirmation: the number the warning referred to is no longer the
    /// number on screen.
    private var amountText: Binding<String> {
        Binding(
            get: { input.editingText(separator: separator) },
            set: {
                input.setDisplay($0, separator: separator)
                confirming = false
            }
        )
    }
}
