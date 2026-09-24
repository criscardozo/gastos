import SwiftUI

/// Settings (design 2c): default budget vs current-period card, preferences,
/// household + invite code, sign out.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var showDefaultAmountSheet = false
    @State private var showPeriodBudgetSheet = false
    @State private var showExtendPeriodSheet = false
    @State private var showCategoriesManager = false
    @State private var editingRule: RecurringRuleDoc?
    @State private var addingRule = false
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
                recurringSection
                householdSection
                signOutRow
                aboutSection
            }
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 24)
        }
        .background(Theme.bg.ignoresSafeArea())
        .statusBarScrim()
        .sheet(isPresented: $showDefaultAmountSheet) {
            DefaultAmountSheet()
        }
        .sheet(isPresented: $showPeriodBudgetSheet) {
            AdjustPeriodBudgetSheet()
        }
        .sheet(isPresented: $showCategoriesManager) {
            CategoriesManagerView()
        }
        .sheet(isPresented: $addingRule) {
            RecurringRuleSheet(rule: nil)
        }
        .sheet(item: $editingRule) { rule in
            RecurringRuleSheet(rule: rule)
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
                        AdaptiveRow {
                            Text(l10n.t("settings.amount"))
                                .appFont(14.5, .semibold)
                                .foregroundStyle(Theme.ink)
                            AdaptiveGap()
                            // Value and chevron in their own row: when the
                            // outer one becomes a column the chevron would
                            // otherwise land alone on a third line, pointing
                            // at nothing.
                            HStack(spacing: 11) {
                                Text(MoneyFormatter.aud(model.household?.defaultBudget.amountCents ?? 0, locale: l10n.locale) + " AUD")
                                    .appFont(14.5, .semibold)
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.inkSecondary)
                                chevron
                            }
                        }
                        .padding(.vertical, 13)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider().overlay(Theme.separator)
                    AdaptiveRow {
                        Text(l10n.t("settings.period"))
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                        AdaptiveGap()
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
                    }
                    .padding(.vertical, 13)
                    Divider().overlay(Theme.separator)
                    AdaptiveRow {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l10n.t("settings.rollover"))
                                .appFont(14.5, .semibold)
                                .foregroundStyle(Theme.ink)
                            Text(l10n.t("settings.rollover.foot"))
                                .appFont(11.5)
                                .foregroundStyle(Theme.inkTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        AdaptiveGap()
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

    // MARK: Recurring rules

    /// Here rather than beside Servicios because it is not a bill: nothing in
    /// this list is due on a date and nothing about it is summed. It is a set
    /// of instructions for what to do when the bank reports something we know.
    private var recurringSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            AdaptiveRow {
                SectionLabel(text: l10n.t("recurring.title"))
                AdaptiveGap()
                Button(l10n.t("recurring.add")) { addingRule = true }
                    .appFont(11.5, .bold)
                    .foregroundStyle(Theme.accentStrong)
            }
            .padding(.horizontal, 4)

            Card {
                VStack(spacing: 0) {
                    if model.recurringRules.isEmpty {
                        Text(l10n.t("recurring.empty"))
                            .appFont(13)
                            .foregroundStyle(Theme.inkTertiary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 13)
                    } else {
                        ForEach(Array(model.recurringRules.enumerated()), id: \.element.id) { index, rule in
                            if index > 0 { Divider().overlay(Theme.separator) }
                            Button {
                                editingRule = rule
                            } label: {
                                AdaptiveRow {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(rule.pattern)
                                            .appFont(14.5, .semibold)
                                            .foregroundStyle(Theme.ink)
                                        Text(rule.note)
                                            .appFont(11.5)
                                            .foregroundStyle(Theme.inkTertiary)
                                    }
                                    AdaptiveGap()
                                    Text(rule.amountAudCents.map {
                                        MoneyFormatter.aud($0, locale: l10n.locale)
                                    } ?? l10n.t("recurring.amountAsk"))
                                        .appFont(13.5, .semibold)
                                        .monospacedDigit()
                                        .foregroundStyle(Theme.inkSecondary)
                                }
                                .padding(.vertical, 13)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            Text(l10n.t("recurring.subtitle"))
                .appFont(12)
                .foregroundStyle(Theme.inkTertiary)
                .fixedSize(horizontal: false, vertical: true)
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
                    AdaptiveRow {
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
                        AdaptiveGap()
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
                    .clipShape(RoundedRectangle(cornerRadius: Theme.card, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.card, style: .continuous)
                            .strokeBorder(
                                period.isCustom ? Color(hex: "#FF5C39", alpha: 0.5) : Theme.border,
                                lineWidth: period.isCustom ? 1.5 : 1
                            )
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // Re-opens the start-period screen for the period under way —
                // the way back in when it was answered by accident.
                Button {
                    model.openNewPeriodPrompt()
                } label: {
                    HStack(spacing: 9) {
                        Image(systemName: "flag.checkered")
                            .appFont(14, .semibold)
                        Text(l10n.t(period.period == .weekly
                                    ? "settings.startPeriod.weekly"
                                    : "settings.startPeriod.fortnightly"))
                            .appFont(14, .bold)
                        Spacer()
                    }
                    .foregroundStyle(Theme.accentStrong)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 13)
                    .background(Theme.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // Only a week can be stretched, and only into a fortnight, so
                // the button simply is not there once it has been.
                if period.period == .weekly {
                    Button {
                        showExtendPeriodSheet = true
                    } label: {
                        HStack(spacing: 9) {
                            Image(systemName: "calendar.badge.plus")
                                .appFont(14, .semibold)
                            Text(l10n.t("extendPeriod.extend"))
                                .appFont(14, .bold)
                            Spacer()
                        }
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 13)
                        .background(Theme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.card, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.card, style: .continuous)
                                .strokeBorder(Theme.borderPill, lineWidth: 1)
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .sheet(isPresented: $showExtendPeriodSheet) {
                        ExtendPeriodSheet(period: period) {
                            showExtendPeriodSheet = false
                        }
                    }
                }
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
                            AdaptiveRow {
                                if let start = period.start, let end = period.end {
                                    Text(l10n.periodRangeCompact(start: start, end: end, timeZone: model.householdTimeZone))
                                        .appFont(13.5, .semibold)
                                        .foregroundStyle(Theme.ink)
                                }
                                AdaptiveGap()
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
                    AdaptiveRow {
                        Text(l10n.t("settings.language"))
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                        AdaptiveGap()
                        SegmentedPill(
                            options: [("es", "Español"), ("en", "English")],
                            selection: Binding(
                                get: { l10n.language },
                                set: { model.setLanguage($0) }
                            )
                        )
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
        AdaptiveRow {
            Text(l10n.t("settings.appearance"))
                .appFont(14.5, .semibold)
                .foregroundStyle(Theme.ink)
            AdaptiveGap()
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
        }
        .padding(.vertical, 13)
    }

    /// Daily reminder toggle + hour picker (local notification, per-device).
    @ViewBuilder
    private var reminderRows: some View {
        AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(l10n.t("settings.reminder"))
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                Text(l10n.t("settings.reminder.foot"))
                    .appFont(11.5)
                    .foregroundStyle(Theme.inkTertiary)
            }
            AdaptiveGap()
            Toggle("", isOn: $reminderEnabled)
                .labelsHidden()
                .tint(Theme.green)
        }
        .padding(.vertical, 13)
        if reminderEnabled {
            Divider().overlay(Theme.separator)
            AdaptiveRow {
                Text(l10n.t("settings.reminder.time"))
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                AdaptiveGap()
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
                AdaptiveGap()
                Text(l10n.t("categories.count", model.household?.categories.count ?? 0))
                    .appFont(11, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
            }
            .padding(.horizontal, 4)
            Button {
                showCategoriesManager = true
            } label: {
                Card {
                    categoriesRow
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, 10)
    }

    /// One row into the manager rather than the whole list. Settings is a list
    /// of things you can change, not a place to read your categories back — the
    /// count in the header already answers "how many", and the sheet is where
    /// any actual editing happens.
    private var categoriesRow: some View {
        let preview = Array((model.household?.sortedCategories ?? []).prefix(5))
        return AdaptiveRow {
            // A few of them, overlapping, as a hint at what is behind the row.
            HStack(spacing: -6) {
                ForEach(Array(preview.enumerated()), id: \.element.id) { _, entry in
                    CategoryCircle(categoryId: entry.id, category: entry.category, size: 26)
                        .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 1.5))
                }
            }
            Text(l10n.t("categories.edit"))
                .appFont(14.5, .semibold)
                .foregroundStyle(Theme.ink)
            AdaptiveGap()
            chevron
        }
        .padding(.vertical, 13)
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
                    .appFont(11, .semibold)
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
                // The rules cap the name at 60 and the web's settings screen
                // has always said so; this field never did.
                .onChange(of: householdNameDraft) { _, typed in
                    if typed.count > Limits.maxHouseholdNameCharacters {
                        householdNameDraft = String(
                            typed.prefix(Limits.maxHouseholdNameCharacters)
                        )
                    }
                }
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
        AdaptiveRow(spacing: 10) {
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
            AdaptiveGap()
            Button {
                guard let code = model.inviteCode else { return }
                UIPasteboard.general.string = code
                withAnimation { copied = true }
                // NOT one of the focus delays, despite being counted with
                // them in the plan. Nothing here is guessing at when a field
                // becomes focusable: 1.6s is how long "Copiado" should stay on
                // screen, which is a designed duration and not a race. The
                // only thing a `.task` would add is cancellation if the view
                // went away mid-count, and the view is a button in Ajustes.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                    withAnimation { copied = false }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc.fill")
                        .appFont(12, .bold)
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
                    .appFont(15, .medium)
                Text(l10n.t("settings.signout"))
                    .appFont(14.5, .semibold)
                Spacer()
            }
            .foregroundStyle(Theme.red)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.card, style: .continuous)
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
                    AdaptiveRow {
                        Text(l10n.t("settings.version"))
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                        AdaptiveGap()
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
                        AdaptiveRow {
                            Text(l10n.t("settings.openWeb"))
                                .appFont(14.5, .semibold)
                                .foregroundStyle(Theme.ink)
                            AdaptiveGap()
                            Image(systemName: "arrow.up.forward.square")
                                .appFont(15, .medium)
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
        return AdaptiveRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(l10n.t("signing.row.title"))
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                Text(l10n.shortDate(expiry))
                    .appFont(11.5)
                    .foregroundStyle(Theme.inkTertiary)
            }
            AdaptiveGap()
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
            .appFont(13, .semibold)
            .foregroundStyle(Theme.inkTertiary.opacity(0.6))
    }
}

// MARK: - Default budget amount sheet

struct DefaultAmountSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var budget = BudgetEntryAmount(maxCents: Limits.maxBudgetAmountCents)
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
                .clipShape(RoundedRectangle(cornerRadius: Theme.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.card, style: .continuous)
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
            budget.setAUDCents(model.household?.defaultBudget.amountCents ?? 0)
        }
    }
}
