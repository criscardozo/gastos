import SwiftUI

/// Period summary (design 2b): hero card with per-period budget, category
/// breakdown, member split and the record of previous periods.
struct SummaryView: View {
    @Environment(AppModel.self) private var model
    @State private var showAdjustSheet = false

    private var l10n: L10n { model.l10n }

    private var period: PeriodBudget? { model.viewedPeriod }
    private var spentCents: Int { model.viewedSpentCents }
    private var budgetCents: Int { period?.amountCents ?? 0 }
    private var remainingCents: Int { budgetCents - spentCents }

    private var state: BudgetState {
        PeriodLogic.budgetState(spentCents: spentCents, budgetCents: budgetCents)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let period {
                    heroCard(period)
                    categoryBreakdown
                    memberSplit
                    pastPeriods
                } else {
                    emptyState
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 24)
        }
        .background(Theme.bg.ignoresSafeArea())
        .sheet(isPresented: $showAdjustSheet) {
            AdjustPeriodBudgetSheet()
        }
    }

    // MARK: Header

    private var header: some View {
        HStack {
            Text(l10n.t("tab.summary"))
                .appFont(18, .bold)
                .foregroundStyle(Theme.ink)
            Spacer()
            if let period, let start = period.start, let end = period.end {
                PeriodNavigator(
                    label: l10n.periodRange(start: start, end: end, timeZone: model.householdTimeZone),
                    canGoBack: (model.viewedPeriodIndex ?? 0) > 0,
                    canGoForward: (model.viewedPeriodIndex ?? 0) < model.periods.count - 1,
                    onBack: { model.navigatePeriod(by: -1) },
                    onForward: { model.navigatePeriod(by: 1) }
                )
            }
        }
    }

    // MARK: Hero card

    private func heroCard(_ period: PeriodBudget) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(l10n.t("summary.remaining"))
                    .appFont(13, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                Spacer()
                StatePill(state: state, label: l10n.t("state.\(state.rawValue)"))
            }

            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(MoneyFormatter.aud(remainingCents, locale: l10n.locale))
                    .amountStyle(52, .bold)
                    .kerning(-0.03 * 52)
                    .foregroundStyle(state == .over ? Theme.red : Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if model.showUSD, let rate = model.usdRate {
                    Text(MoneyFormatter.approxUSD(audCents: remainingCents, rate: rate, locale: l10n.locale))
                        .appFont(13, .semibold)
                        .monospacedDigit()
                        .foregroundStyle(Theme.inkSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Theme.fill)
                        .clipShape(Capsule())
                }
            }

            BudgetBar(
                state: state,
                fraction: budgetCents > 0 ? Double(spentCents) / Double(budgetCents) : 0
            )

            HStack {
                (
                    Text(l10n.t("summary.spent") + " ")
                        .foregroundColor(Theme.inkSecondary)
                    + Text(MoneyFormatter.aud(spentCents, locale: l10n.locale))
                        .foregroundColor(Theme.ink)
                        .fontWeight(.bold)
                    + Text(" " + l10n.t("summary.of", MoneyFormatter.audCompact(budgetCents, locale: l10n.locale)))
                        .foregroundColor(Theme.inkSecondary)
                )
                .appFont(13, .semibold)
                .monospacedDigit()
                Spacer()
                if model.isViewingCurrentPeriod, let end = period.end {
                    let days = max(PeriodLogic.daysBetween(model.today, end) + 1, 0)
                    (
                        daysLeftPrefix
                        + Text(l10n.daysCount(days)).foregroundColor(Theme.ink).fontWeight(.bold)
                        + daysLeftSuffix
                    )
                    .appFont(13, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                    .monospacedDigit()
                }
            }

            budgetInsetRow(period)
        }
        .padding(EdgeInsets(top: 22, leading: 20, bottom: 22, trailing: 20))
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
    }

    private var daysLeftPrefix: Text {
        Text(verbatim: l10n.language == "es" ? "Quedan " : "")
    }

    private var daysLeftSuffix: Text {
        Text(verbatim: l10n.language == "es" ? "" : " left")
    }

    /// Inset "PRESUPUESTO DEL PERÍODO $900 · Quincenal (por defecto)" row.
    private func budgetInsetRow(_ period: PeriodBudget) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text(l10n.t("summary.periodBudget").uppercased())
                    .appFont(11, .bold)
                    .kerning(11 * 0.05)
                    .foregroundStyle(Theme.inkTertiary)
                (
                    Text(MoneyFormatter.audCompact(period.amountCents, locale: l10n.locale))
                    + Text(" · \(l10n.t("period.\(period.period.rawValue)")) ")
                    + Text(period.isCustom ? l10n.t("source.custom") : l10n.t("source.default"))
                        .foregroundColor(Theme.inkTertiary)
                        .fontWeight(.medium)
                )
                .appFont(14.5, .bold)
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
            }
            Spacer()
            if model.isViewingCurrentPeriod {
                Button {
                    showAdjustSheet = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "pencil")
                            .font(.system(size: 11, weight: .bold))
                        Text(l10n.t("summary.adjust"))
                            .appFont(12, .bold)
                    }
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Theme.surface)
                    .clipShape(Capsule())
                    .overlay(Capsule().strokeBorder(Theme.borderPill, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Theme.bg)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Category breakdown

    private struct CategoryTotal: Identifiable {
        let id: String
        let category: Category
        let totalCents: Int
    }

    private var categoryTotals: [CategoryTotal] {
        guard let household = model.household else { return [] }
        var totals: [String: Int] = [:]
        for item in model.viewedExpenses {
            totals[item.expense.categoryId, default: 0] += item.expense.amountCents
        }
        return totals.compactMap { id, total in
            household.categories[id].map { CategoryTotal(id: id, category: $0, totalCents: total) }
        }
        .sorted { $0.totalCents > $1.totalCents }
    }

    @ViewBuilder
    private var categoryBreakdown: some View {
        let totals = categoryTotals
        if !totals.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: l10n.t("summary.byCategory"))
                Card(padding: EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16)) {
                    VStack(spacing: 0) {
                        ForEach(totals) { entry in
                            HStack(spacing: 11) {
                                CategoryCircle(categoryId: entry.id, category: entry.category, size: 34)
                                VStack(spacing: 5) {
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(l10n.categoryName(entry.category))
                                            .appFont(13.5, .semibold)
                                            .foregroundStyle(Theme.ink)
                                        Spacer()
                                        Text(MoneyFormatter.aud(entry.totalCents, locale: l10n.locale))
                                            .appFont(13.5, .semibold)
                                            .monospacedDigit()
                                            .foregroundStyle(Theme.ink)
                                    }
                                    MiniBar(
                                        color: Theme.categoryColor(id: entry.id, lightHex: entry.category.color),
                                        fraction: spentCents > 0 ? Double(entry.totalCents) / Double(spentCents) : 0
                                    )
                                }
                            }
                            .padding(.vertical, 9)
                        }
                    }
                }
            }
        }
    }

    // MARK: Member split

    @ViewBuilder
    private var memberSplit: some View {
        let members = model.members
        if !members.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: l10n.t("summary.betweenUs"))
                HStack(spacing: 10) {
                    ForEach(members, id: \.uid) { member in
                        memberCard(uid: member.uid, profile: member.profile)
                    }
                }
            }
        }
    }

    private func memberCard(uid: String, profile: MemberProfile) -> some View {
        let total = model.viewedExpenses
            .filter { $0.expense.createdBy == uid }
            .reduce(0) { $0 + $1.expense.amountCents }
        let fraction = spentCents > 0 ? Double(total) / Double(spentCents) : 0
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                MemberAvatar(profile: profile, size: 26)
                Text(profile.displayName.split(separator: " ").first.map(String.init) ?? profile.displayName)
                    .appFont(13, .semibold)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
            }
            Text(MoneyFormatter.aud(total, locale: l10n.locale))
                .appFont(19, .bold)
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
            MiniBar(color: Theme.avatarColor(hex: profile.color), fraction: fraction)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
    }

    // MARK: Past periods

    @ViewBuilder
    private var pastPeriods: some View {
        let past = model.pastPeriods
        if !past.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: l10n.t("summary.pastPeriods"))
                Card(padding: EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)) {
                    VStack(spacing: 0) {
                        ForEach(Array(past.enumerated()), id: \.element.startDate) { index, period in
                            pastPeriodRow(period)
                            if index < past.count - 1 {
                                Divider().overlay(Theme.separator)
                            }
                        }
                    }
                }
                Text(l10n.t("summary.pastPeriods.foot"))
                    .appFont(12)
                    .foregroundStyle(Theme.inkTertiary)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func pastPeriodRow(_ period: PeriodBudget) -> some View {
        Button {
            if let index = model.periods.firstIndex(where: { $0.startDate == period.startDate }) {
                model.viewedPeriodIndex = index
                model.navigatePeriod(by: 0)
            }
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    if let start = period.start, let end = period.end {
                        Text(l10n.periodRangeCompact(start: start, end: end, timeZone: model.householdTimeZone))
                            .appFont(14, .semibold)
                            .foregroundStyle(Theme.ink)
                    }
                    Text("\(l10n.t("period.\(period.period.rawValue)")) · \(MoneyFormatter.audCompact(period.amountCents, locale: l10n.locale))")
                        .appFont(12)
                        .monospacedDigit()
                        .foregroundStyle(Theme.inkTertiary)
                }
                Spacer()
                if let spent = model.pastTotals[period.startDate] {
                    let leftover = period.amountCents - spent
                    let over = leftover < 0
                    Text(l10n.t(
                        over ? "pastPeriod.over" : "pastPeriod.under",
                        MoneyFormatter.aud(abs(leftover), locale: l10n.locale)
                    ))
                    .appFont(12, .bold)
                    .monospacedDigit()
                    .foregroundStyle(over ? Theme.redText : Theme.greenText)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 5)
                    .background(over ? Theme.redBg : Theme.greenBg)
                    .clipShape(Capsule())
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.inkTertiary.opacity(0.6))
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        Card(padding: EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16)) {
            HStack(spacing: 12) {
                Image(systemName: "flag")
                    .font(.system(size: 22))
                    .foregroundStyle(Theme.inkTertiary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(l10n.t("empty.noPeriod.title"))
                        .appFont(13.5, .bold)
                        .foregroundStyle(Theme.ink)
                    Text(l10n.t("empty.noPeriod.body"))
                        .appFont(12)
                        .foregroundStyle(Theme.inkTertiary)
                }
                Spacer()
            }
        }
    }
}

// MARK: - Adjust current period budget sheet

struct AdjustPeriodBudgetSheet: View {
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
                Text(l10n.t("adjust.title"))
                    .appFont(20, .bold)
                    .foregroundStyle(Theme.ink)
                if let period = model.currentPeriod, let start = period.start, let end = period.end {
                    Text(l10n.periodRange(start: start, end: end, timeZone: model.householdTimeZone))
                        .appFont(13.5)
                        .foregroundStyle(Theme.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            BudgetAmountEditor(value: $budget, showsCurrencyCode: false)
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

            Text(l10n.t("adjust.foot"))
                .appFont(12)
                .foregroundStyle(Theme.inkTertiary)
                .multilineTextAlignment(.center)

            PrimaryCTA(title: l10n.t("common.save"), height: 56, enabled: budget.audCents > 0) {
                model.adjustCurrentPeriodBudget(amountCents: budget.audCents)
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
            budget = .fromAUDCents(model.currentPeriod?.amountCents ?? 0)
        }
    }
}
