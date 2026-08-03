import SwiftUI

/// Settings (design 2c): default budget vs current-period card, preferences,
/// household + invite code, sign out.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var showDefaultAmountSheet = false
    @State private var showPeriodBudgetSheet = false
    @State private var showCategoriesManager = false
    @State private var copied = false
    @State private var renamingHousehold = false
    @State private var householdNameDraft = ""


    // Daily reminder (per-device preference; see ReminderService).
    @State private var reminderEnabled = ReminderService.isEnabled
    @State private var reminderTime = SettingsView.storedReminderTime()
    @State private var reminderDenied = false

    private var l10n: L10n { model.l10n }

    private static func storedReminderTime() -> Date {
        let time = ReminderService.time
        return Calendar.current.date(
            bySettingHour: time.hour, minute: time.minute, second: 0, of: Date()
        ) ?? Date()
    }

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
                categoriesSection
                householdSection
                signOutRow
                aboutSection
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
        .sheet(isPresented: $showCategoriesManager) {
            CategoriesManagerView()
        }
        .onAppear { model.ensureInviteCode() }
        .task {
            // Surface the system-level denial when the toggle was left on.
            if reminderEnabled, await ReminderService.isDenied() {
                reminderDenied = true
            }
        }
        .onChange(of: reminderEnabled) { _, enabled in
            let l10n = self.l10n
            Task {
                if enabled {
                    let granted = await ReminderService.enable(l10n: l10n)
                    if granted {
                        reminderDenied = false
                    } else {
                        reminderEnabled = false
                        reminderDenied = true
                    }
                } else {
                    ReminderService.disable()
                }
            }
        }
        .onChange(of: reminderTime) { _, newValue in
            let comps = Calendar.current.dateComponents([.hour, .minute], from: newValue)
            let l10n = self.l10n
            Task {
                await ReminderService.setTime(
                    hour: comps.hour ?? 21,
                    minute: comps.minute ?? 0,
                    l10n: l10n
                )
            }
        }
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
                    Divider().overlay(Theme.separator)
                    HStack(spacing: 11) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l10n.t("settings.rollover"))
                                .appFont(14.5, .semibold)
                                .foregroundStyle(Theme.ink)
                            Text(l10n.t("settings.rollover.foot"))
                                .appFont(11.5)
                                .foregroundStyle(Theme.inkTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { model.household?.defaultBudget.rollover == true },
                            set: { model.setRollover($0) }
                        ))
                        .labelsHidden()
                        .tint(Theme.green)
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
                        Text(l10n.t("settings.entryCurrency"))
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                        Spacer()
                        SegmentedPill(
                            options: [("AUD", "AUD"), ("USD", "USD")],
                            selection: Binding(
                                get: { model.defaultEntryCurrency },
                                set: { model.setDefaultEntryCurrency($0) }
                            )
                        )
                        .fixedSize()
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
                    Divider().overlay(Theme.separator)
                    appearanceRow
                    Divider().overlay(Theme.separator)
                    reminderRows
                }
            }
            if reminderDenied {
                Text(l10n.t("settings.reminder.denied"))
                    .appFont(12)
                    .foregroundStyle(Theme.inkTertiary)
                    .padding(.horizontal, 4)
            }
        }
        .padding(.bottom, 10)
    }

    /// Manual appearance: Sistema / Claro / Oscuro (per-device preference).
    private var appearanceRow: some View {
        HStack(spacing: 11) {
            Text(l10n.t("settings.appearance"))
                .appFont(14.5, .semibold)
                .foregroundStyle(Theme.ink)
            Spacer()
            SegmentedPill(
                options: [
                    (AppModel.AppearanceMode.system, l10n.t("appearance.system")),
                    (AppModel.AppearanceMode.light, l10n.t("appearance.light")),
                    (AppModel.AppearanceMode.dark, l10n.t("appearance.dark")),
                ],
                selection: Binding(
                    get: { model.appearance },
                    set: { model.setAppearance($0) }
                )
            )
            .fixedSize()
        }
        .padding(.vertical, 13)
    }

    /// Daily reminder toggle + hour picker (local notification, per-device).
    @ViewBuilder
    private var reminderRows: some View {
        HStack(spacing: 11) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l10n.t("settings.reminder"))
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                Text(l10n.t("settings.reminder.foot"))
                    .appFont(11.5)
                    .foregroundStyle(Theme.inkTertiary)
            }
            Spacer()
            Toggle("", isOn: $reminderEnabled)
                .labelsHidden()
                .tint(Theme.green)
        }
        .padding(.vertical, 13)
        if reminderEnabled {
            Divider().overlay(Theme.separator)
            HStack(spacing: 11) {
                Text(l10n.t("settings.reminder.time"))
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                Spacer()
                DatePicker("", selection: $reminderTime, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.compact)
                    .labelsHidden()
            }
            .padding(.vertical, 8)
        }
    }

    // MARK: Categories

    private var categoriesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionLabel(text: l10n.t("settings.categories"))
                Spacer()
                Text(l10n.t("categories.count", model.household?.categories.count ?? 0))
                    .appFont(11, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
            }
            .padding(.horizontal, 4)
            Button {
                showCategoriesManager = true
            } label: {
                Card(padding: EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)) {
                    categoriesList
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, 10)
    }

    private var categoriesList: some View {
        let entries = model.household?.sortedCategories ?? []
        return VStack(spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                HStack(spacing: 11) {
                    CategoryCircle(categoryId: entry.id, category: entry.category, size: 30)
                    Text(l10n.categoryName(entry.category))
                        .appFont(14, .semibold)
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    if index == 0 {
                        editPill
                    }
                }
                .padding(.vertical, 8)
                if index < entries.count - 1 {
                    Divider().overlay(Theme.separator)
                }
            }
        }
    }

    private var editPill: some View {
        HStack(spacing: 4) {
            Image(systemName: "pencil")
                .font(.system(size: 11, weight: .bold))
            Text(l10n.t("categories.edit"))
                .appFont(12, .bold)
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Theme.surface)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Theme.borderPill, lineWidth: 1))
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
                        VStack(alignment: .leading, spacing: 1) {
                            householdNameButton
                            Text(memberNames)
                                .appFont(12)
                                .foregroundStyle(Theme.inkTertiary)
                                .lineLimit(1)
                        }
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

    /// Tapping the household name opens a rename prompt — same capability the
    /// web has; either member may rename.
    private var householdNameButton: some View {
        Button {
            householdNameDraft = model.household?.name ?? ""
            renamingHousehold = true
        } label: {
            HStack(spacing: 5) {
                Text(model.household?.name ?? "")
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Image(systemName: "pencil")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.inkTertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .alert(
            l10n.t("settings.household.rename"),
            isPresented: $renamingHousehold
        ) {
            TextField(l10n.t("settings.household.name.placeholder"), text: $householdNameDraft)
            Button(l10n.t("common.save")) {
                model.setHouseholdName(householdNameDraft)
            }
            Button(l10n.t("common.cancel"), role: .cancel) {}
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

    // MARK: About

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: l10n.t("settings.about"))
                .padding(.horizontal, 4)
            Card {
                VStack(spacing: 0) {
                    HStack(spacing: 11) {
                        Text(l10n.t("settings.version"))
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                        Spacer()
                        Text(appVersion)
                            .appFont(14.5, .semibold)
                            .monospacedDigit()
                            .foregroundStyle(Theme.inkSecondary)
                    }
                    .padding(.vertical, 13)
                    if let expiry = SigningExpiryService.expiryDate {
                        Divider().overlay(Theme.separator)
                        signingExpiryRow(expiry)
                    }
                    Divider().overlay(Theme.separator)
                    Link(destination: URL(string: "https://gastos.cardozo.dev")!) {
                        HStack(spacing: 11) {
                            Text(l10n.t("settings.openWeb"))
                                .appFont(14.5, .semibold)
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Image(systemName: "arrow.up.forward.square")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(Theme.inkTertiary)
                        }
                        .padding(.vertical, 13)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 10)
    }

    /// Free-account signing lasts 7 days; show exactly when this build dies.
    /// Only rendered when a provisioning profile exists (never in Simulator).
    private func signingExpiryRow(_ expiry: Date) -> some View {
        let days = SigningExpiryService.daysRemaining() ?? 0
        let expired = days < 0
        let colour: Color = expired || days <= 1
            ? Theme.redText
            : (days <= 2 ? Theme.accentStrong : Theme.inkSecondary)
        return HStack(spacing: 11) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l10n.t("signing.row.title"))
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                Text(l10n.shortDate(expiry))
                    .appFont(11.5)
                    .foregroundStyle(Theme.inkTertiary)
            }
            Spacer()
            Text(
                expired
                    ? l10n.t("signing.row.expired")
                    : (days == 0 ? l10n.t("signing.row.today") : l10n.t("signing.row.days", days))
            )
            .appFont(13, .bold)
            .monospacedDigit()
            .foregroundStyle(colour)
        }
        .padding(.vertical, 13)
    }

    /// "1.0.0 (1)" from the bundle.
    private var appVersion: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        return "\(short) (\(build))"
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
    @State private var budget = BudgetEntryAmount()
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

            BudgetAmountEditor(value: $budget)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Theme.border, lineWidth: 1)
                )

            KeypadView(separatorLabel: separator) { key in
                budget.tap(key)
            }

            PrimaryCTA(title: l10n.t("common.save"), height: 56, enabled: budget.audCents > 0) {
                model.setDefaultBudget(amountCents: budget.audCents)
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
            budget = .fromAUDCents(model.household?.defaultBudget.amountCents ?? 0)
        }
    }
}
