import SwiftUI

/// Settings (design 2c): default budget vs current-period card, preferences,
/// household + invite code, sign out.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var showDefaultAmountSheet = false
    @State private var showPeriodBudgetSheet = false
    @State private var copied = false

    private var l10n: L10n { model.l10n }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(l10n.t("tab.settings"))
                    .appFont(18, .bold)
                    .foregroundStyle(Theme.ink)
                    .padding(.bottom, 8)

                defaultBudgetSection
                currentPeriodSection
                logSection
                preferencesSection
                householdSection
                signOutRow
            }
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 24)
        }
        .background(Theme.bg.ignoresSafeArea())
        .sheet(isPresented: $showDefaultAmountSheet) {
            DefaultAmountSheet()
        }
        .sheet(isPresented: $showPeriodBudgetSheet) {
            AdjustPeriodBudgetSheet()
        }
        .onAppear { model.ensureInviteCode() }
    }

    // MARK: Default budget

    private var defaultBudgetSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: l10n.t("settings.defaultBudget"))
                .padding(.horizontal, 4)
            Card {
                VStack(spacing: 0) {
                    Button {
                        showDefaultAmountSheet = true
                    } label: {
                        HStack(spacing: 11) {
                            Text(l10n.t("settings.amount"))
                                .appFont(14.5, .semibold)
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Text(MoneyFormatter.aud(model.household?.defaultBudget.amountCents ?? 0, locale: l10n.locale) + " AUD")
                                .appFont(14.5, .semibold)
                                .monospacedDigit()
                                .foregroundStyle(Theme.inkSecondary)
                            chevron
                        }
                        .padding(.vertical, 13)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider().overlay(Theme.separator)
                    HStack(spacing: 11) {
                        Text(l10n.t("settings.period"))
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                        Spacer()
                        SegmentedPill(
                            options: [
                                (PeriodType.weekly, l10n.t("period.weekly")),
                                (PeriodType.fortnightly, l10n.t("period.fortnightly")),
                            ],
                            selection: Binding(
                                get: { model.household?.defaultBudget.period ?? .fortnightly },
                                set: { model.setDefaultBudget(period: $0) }
                            )
                        )
                        .fixedSize()
                    }
                    .padding(.vertical, 13)
                }
            }
            Text(l10n.t("settings.default.foot"))
                .appFont(12)
                .foregroundStyle(Theme.inkTertiary)
                .padding(.horizontal, 4)
                .padding(.bottom, 10)
        }
    }

    // MARK: Current period

    @ViewBuilder
    private var currentPeriodSection: some View {
        if let period = model.currentPeriod, let start = period.start, let end = period.end {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "\(l10n.t("settings.thisPeriod")) · \(l10n.periodRangeCompact(start: start, end: end, timeZone: model.householdTimeZone))")
                    .padding(.horizontal, 4)
                Button {
                    showPeriodBudgetSheet = true
                } label: {
                    HStack(spacing: 11) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l10n.t(period.period == .weekly
                                        ? "settings.thisPeriod.budget.weekly"
                                        : "settings.thisPeriod.budget.fortnightly"))
                                .appFont(14.5, .semibold)
                                .foregroundStyle(Theme.ink)
                            Text(l10n.t("settings.thisPeriod.sub"))
                                .appFont(12)
                                .foregroundStyle(Theme.inkTertiary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text(MoneyFormatter.aud(period.amountCents, locale: l10n.locale))
                                .appFont(14.5, .bold)
                                .monospacedDigit()
                                .foregroundStyle(Theme.ink)
                            if period.isCustom {
                                Text(l10n.t("settings.adjusted"))
                                    .appFont(10.5, .bold)
                                    .foregroundStyle(Theme.accentStrong)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 2)
                                    .background(Theme.accentSoft)
                                    .clipShape(Capsule())
                            }
                        }
                        chevron
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 13)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(
                                period.isCustom ? Color(hex: "#FF5C39", alpha: 0.5) : Theme.border,
                                lineWidth: period.isCustom ? 1.5 : 1
                            )
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Text(l10n.t("settings.thisPeriod.foot"))
                    .appFont(12)
                    .foregroundStyle(Theme.inkTertiary)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 10)
            }
        }
    }

    // MARK: Log of past periods

    @ViewBuilder
    private var logSection: some View {
        let past = model.pastPeriods
        if !past.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: l10n.t("settings.log"))
                    .padding(.horizontal, 4)
                Card {
                    VStack(spacing: 0) {
                        ForEach(Array(past.enumerated()), id: \.element.startDate) { index, period in
                            HStack(spacing: 11) {
                                if let start = period.start, let end = period.end {
                                    Text(l10n.periodRangeCompact(start: start, end: end, timeZone: model.householdTimeZone))
                                        .appFont(13.5, .semibold)
                                        .foregroundStyle(Theme.ink)
                                }
                                Spacer()
                                Text("\(l10n.t("period.\(period.period.rawValue)")) · \(MoneyFormatter.audCompact(period.amountCents, locale: l10n.locale))")
                                    .appFont(13)
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.inkSecondary)
                            }
                            .padding(.vertical, 12)
                            if index < past.count - 1 {
                                Divider().overlay(Theme.separator)
                            }
                        }
                    }
                }
                .padding(.bottom, 10)
            }
        }
    }

    // MARK: Preferences

    private var preferencesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: l10n.t("settings.preferences"))
                .padding(.horizontal, 4)
            Card {
                VStack(spacing: 0) {
                    HStack(spacing: 11) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l10n.t("settings.usd"))
                                .appFont(14.5, .semibold)
                                .foregroundStyle(Theme.ink)
                            Text(l10n.t("settings.usd.foot"))
                                .appFont(11.5)
                                .foregroundStyle(Theme.inkTertiary)
                        }
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { model.showUSD },
                            set: { model.setDisplayCurrency(usd: $0) }
                        ))
                        .labelsHidden()
                        .tint(Theme.green)
                    }
                    .padding(.vertical, 13)
                    Divider().overlay(Theme.separator)
                    HStack(spacing: 11) {
                        Text(l10n.t("settings.language"))
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                        Spacer()
                        SegmentedPill(
                            options: [("es", "Español"), ("en", "English")],
                            selection: Binding(
                                get: { l10n.language },
                                set: { model.setLanguage($0) }
                            )
                        )
                        .fixedSize()
                    }
                    .padding(.vertical, 13)
                }
            }
            .padding(.bottom, 10)
        }
    }

    // MARK: Household

    private var householdSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: l10n.t("settings.household"))
                .padding(.horizontal, 4)
            Card(padding: EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        HStack(spacing: -9) {
                            ForEach(model.members, id: \.uid) { member in
                                MemberAvatar(profile: member.profile, size: 30)
                                    .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                            }
                        }
                        Text(memberNames)
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                    }
                    if model.members.count < 2 {
                        inviteCard
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.bottom, 10)
        }
    }

    private var memberNames: String {
        let names = model.members.map {
            $0.profile.displayName.split(separator: " ").first.map(String.init) ?? $0.profile.displayName
        }
        return names.joined(separator: l10n.language == "es" ? " y " : " & ")
    }

    private var inviteCard: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l10n.t("settings.invite.label").uppercased())
                    .appFont(10.5, .semibold)
                    .kerning(10.5 * 0.05)
                    .foregroundStyle(Theme.inkTertiary)
                Text(model.inviteCode ?? "GD-········")
                    .appFont(16, .bold)
                    .kerning(16 * 0.12)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer()
            Button {
                guard let code = model.inviteCode else { return }
                UIPasteboard.general.string = code
                withAnimation { copied = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                    withAnimation { copied = false }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc.fill")
                        .font(.system(size: 12, weight: .bold))
                    Text(l10n.t(copied ? "settings.copied" : "settings.copy"))
                        .appFont(12.5, .bold)
                }
                .foregroundStyle(Theme.bg)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Theme.ink)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(model.inviteCode == nil)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    Theme.ink.opacity(0.2),
                    style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])
                )
        )
    }

    // MARK: Sign out

    private var signOutRow: some View {
        Button {
            model.signOut()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 15, weight: .medium))
                Text(l10n.t("settings.signout"))
                    .appFont(14.5, .semibold)
                Spacer()
            }
            .foregroundStyle(Theme.red)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.inkTertiary.opacity(0.6))
    }
}

// MARK: - Default budget amount sheet

struct DefaultAmountSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var amount = AmountInput()
    @State private var loaded = false

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }

    var body: some View {
        VStack(spacing: 16) {
            Capsule()
                .fill(Theme.ink.opacity(0.15))
                .frame(width: 40, height: 5)
                .padding(.top, 14)

            VStack(alignment: .leading, spacing: 3) {
                Text(l10n.t("settings.defaultAmount.title"))
                    .appFont(20, .bold)
                    .foregroundStyle(Theme.ink)
                Text(l10n.t("settings.default.foot"))
                    .appFont(13.5)
                    .foregroundStyle(Theme.inkSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("$")
                    .appFont(22, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
                Text(amount.display(separator: separator))
                    .amountStyle(46, .bold)
                    .kerning(-0.03 * 46)
                    .foregroundStyle(Theme.ink)
                Text("AUD")
                    .appFont(15, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
                    .padding(.leading, 4)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )

            KeypadView(separatorLabel: separator) { key in
                amount.tap(key)
            }

            PrimaryCTA(title: l10n.t("common.save"), height: 56, enabled: amount.cents > 0) {
                model.setDefaultBudget(amountCents: amount.cents)
                dismiss()
            }
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 24)
        .background(Theme.bg.ignoresSafeArea())
        .presentationDetents([.large])
        .onAppear {
            guard !loaded else { return }
            loaded = true
            amount = .fromCents(model.household?.defaultBudget.amountCents ?? 0)
        }
    }
}
