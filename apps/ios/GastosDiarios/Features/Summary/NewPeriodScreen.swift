import SwiftUI

/// Starting a period: the first thing seen inside a freshly materialized one.
///
/// Presented full screen and NOT dismissable on purpose. It used to be a sheet
/// you could swipe away, and swiping away silently kept the default budget —
/// the decision looked optional when it isn't. Now the only ways out are the
/// two answers it asks for:
///
///   • Repeat the usual budget, optionally carrying whatever the last period
///     left over (the amount is right there, so "how much was left?" is not a
///     separate trip to another screen).
///   • Set a different amount for this period alone.
///
/// It is also reachable from Settings, for the period already under way. Opened
/// that way it CAN be closed, because nobody was asked anything.
struct NewPeriodScreen: View {
    @Environment(AppModel.self) private var model
    /// Opened by hand from Settings rather than by a period starting.
    var manual: Bool = false

    @State private var includeRollover = false
    @State private var editingAmount = false
    @State private var custom = BudgetEntryAmount()
    /// Leftover of the period before this one; nil until the read lands (or
    /// when there is no previous period to have left anything).
    @State private var leftover: Int?
    @State private var loaded = false

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }
    private var period: PeriodBudget? { model.currentPeriod }
    private var isWeekly: Bool { period?.period == .weekly }
    private var defaultAmount: Int { model.household?.defaultBudget.amountCents ?? 0 }

    /// What "repeat" would set: the usual budget, plus the carried leftover
    /// when it is being included. Never below 1 — the rules require a positive
    /// budget, so a deficit can empty the envelope but not invert it.
    private var repeatAmount: Int {
        guard includeRollover, let leftover else { return defaultAmount }
        return max(1, defaultAmount + leftover)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Spacer(minLength: 12)
            amountBlock
            Spacer(minLength: 12)
            if leftover != nil, leftover != 0 {
                rolloverRow
            }
            actions
        }
        .padding(.horizontal, 22)
        .padding(.top, 26)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .sheet(isPresented: $editingAmount) { customAmountSheet }
        .task {
            guard !loaded else { return }
            loaded = true
            // Default the checkbox to the household's own policy: someone who
            // asked for the leftover to carry shouldn't have to say so weekly.
            includeRollover = model.household?.defaultBudget.rollover == true
            leftover = await model.previousLeftoverCents()
        }
    }

    // MARK: Pieces

    private var header: some View {
        VStack(spacing: 6) {
            Text(l10n.t(isWeekly ? "newPeriod.title.weekly" : "newPeriod.title.fortnightly"))
                .appFont(24, .bold)
                .foregroundStyle(Theme.ink)
            if let period, let start = period.start, let end = period.end {
                Text(l10n.periodRange(start: start, end: end, timeZone: model.householdTimeZone))
                    .appFont(14)
                    .foregroundStyle(Theme.inkSecondary)
            }
            Text(l10n.t("newPeriod.question"))
                .appFont(13.5)
                .foregroundStyle(Theme.inkTertiary)
                .padding(.top, 2)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }

    /// The figure "Repetir" would set, big, so the button below only has to be
    /// pressed — and it moves when the leftover is toggled.
    private var amountBlock: some View {
        VStack(spacing: 8) {
            Text(MoneyFormatter.aud(repeatAmount, locale: l10n.locale))
                .amountStyle(46, .bold)
                .kerning(-0.03 * 46)
                .foregroundStyle(Theme.ink)
                .contentTransition(.numericText())
                .animation(.snappy(duration: 0.2), value: repeatAmount)
            if includeRollover, let leftover, leftover != 0 {
                Text(l10n.t(
                    "newPeriod.breakdown",
                    MoneyFormatter.aud(defaultAmount, locale: l10n.locale),
                    MoneyFormatter.aud(abs(leftover), locale: l10n.locale)
                ))
                .appFont(12.5, .semibold)
                .foregroundStyle(Theme.inkTertiary)
                .multilineTextAlignment(.center)
            } else {
                Text(l10n.t("newPeriod.defaultBadge"))
                    .appFont(11.5, .bold)
                    .foregroundStyle(Theme.greenText)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 4)
                    .background(Theme.greenBg)
                    .clipShape(Capsule())
            }
        }
    }

    /// "Incluir lo que sobró · $123,45" — a plain checkbox row, with the figure
    /// on it. A deficit says so rather than pretending it is a bonus.
    private var rolloverRow: some View {
        Button {
            withAnimation(.snappy(duration: 0.2)) { includeRollover.toggle() }
        } label: {
            HStack(spacing: 11) {
                Image(systemName: includeRollover ? "checkmark.square.fill" : "square")
                    .font(.system(size: 21, weight: .medium))
                    .foregroundStyle(includeRollover ? Theme.accent : Theme.inkTertiary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(l10n.t((leftover ?? 0) >= 0
                                ? "newPeriod.includeLeftover"
                                : "newPeriod.includeDeficit"))
                        .appFont(14.5, .semibold)
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                    Text(MoneyFormatter.aud(abs(leftover ?? 0), locale: l10n.locale))
                        .appFont(12.5, .semibold)
                        .monospacedDigit()
                        .foregroundStyle((leftover ?? 0) >= 0 ? Theme.greenText : Theme.redText)
                }
                Spacer()
            }
            .padding(EdgeInsets(top: 13, leading: 15, bottom: 13, trailing: 15))
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(includeRollover ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.bottom, 14)
    }

    private var actions: some View {
        VStack(spacing: 12) {
            PrimaryCTA(
                title: l10n.t(
                    "newPeriod.repeat",
                    MoneyFormatter.audCompact(repeatAmount, locale: l10n.locale)
                ),
                height: 56,
                enabled: repeatAmount > 0
            ) {
                model.confirmNewPeriod(
                    amountCents: repeatAmount,
                    rolloverCents: includeRollover ? (leftover ?? 0) : 0
                )
            }
            Button {
                custom = .fromAUDCents(defaultAmount)
                editingAmount = true
            } label: {
                Text(l10n.t("newPeriod.custom"))
                    .appFont(15, .bold)
                    .foregroundStyle(Theme.accentStrong)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(Theme.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            // Only when nobody was asked anything: the automatic prompt has no
            // way out other than answering it.
            if manual {
                Button(l10n.t("common.cancel")) { model.markNewPeriodSeen() }
                    .appFont(14, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                    .padding(.top, 2)
            }
        }
    }

    /// Typing a one-off amount for this period. The keypad is the same one the
    /// budget editors use, so the value that leaves is integer cents.
    private var customAmountSheet: some View {
        VStack(spacing: 18) {
            Text(l10n.t("newPeriod.custom.title"))
                .appFont(19, .bold)
                .foregroundStyle(Theme.ink)
                .padding(.top, 22)
            BudgetAmountEditor(value: $custom, showsCurrencyCode: false)
                .frame(maxWidth: .infinity)
            KeypadView(separatorLabel: separator) { key in
                custom.tap(key)
            }
            PrimaryCTA(
                title: l10n.t("newPeriod.custom.save"),
                height: 54,
                enabled: custom.audCents > 0
            ) {
                editingAmount = false
                // A one-off amount is exactly what was typed: the leftover is
                // part of "the usual budget", not of a number chosen by hand.
                model.confirmNewPeriod(amountCents: custom.audCents, rolloverCents: 0)
            }
            Button(l10n.t("common.cancel")) { editingAmount = false }
                .appFont(14, .semibold)
                .foregroundStyle(Theme.inkSecondary)
                .padding(.bottom, 8)
        }
        .padding(.horizontal, 22)
        .background(Theme.bg.ignoresSafeArea())
        .presentationDetents([.large])
    }
}
