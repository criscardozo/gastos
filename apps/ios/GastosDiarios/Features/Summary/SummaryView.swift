import SwiftUI

/// Period summary (design 2b): hero card with per-period budget, category
/// breakdown, member split and the record of previous periods.
struct SummaryView: View {
    @Environment(AppModel.self) private var model
    /// Rows that cannot share their width at the accessibility sizes stack
    /// instead. Read here rather than guessed from the point size: it is the
    /// system's own answer to "is the text big now".
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var showAdjustSheet = false

    private var l10n: L10n { model.l10n }

    private var period: PeriodBudget? { model.viewedPeriod }
    /// Spending that consumes the budget (excluded categories left out).
    private var spentCents: Int { model.viewedSpentCents }
    /// Everything spent, for the breakdown's relative bars.
    private var totalSpentCents: Int { model.viewedTotalSpentCents }
    private var budgetCents: Int { period?.amountCents ?? 0 }
    private var remainingCents: Int { budgetCents - spentCents }

    private var state: BudgetState {
        PeriodLogic.budgetState(spentCents: spentCents, budgetCents: budgetCents)
    }

    /// A money figure for a sum, sized by the caller.
    private func amountText(_ cents: Int, size: CGFloat) -> some View {
        Text(MoneyFormatter.aud(cents, locale: l10n.locale))
            .appFont(size, .bold)
            .monospacedDigit()
            .foregroundStyle(Theme.ink)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let period {
                    heroCard(period)
                    spendCards
                    categoryBreakdown
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
        // Past-period totals come from one-shot aggregations, not listeners.
        .onAppear { model.refreshPastTotals() }
        .newExpenseButton()
    }

    // MARK: Header

    private var header: some View {
        // Side by side normally; stacked once the text is big enough that the
        // two cannot share a row. Sharing it at an accessibility size left the
        // date range about a third of the screen wide, so "5 – 18 de
        // septiembre" wrapped mid-word and spilled outside its own capsule.
        //
        // Reflow rather than truncate: the range is the label that says WHICH
        // period everything below belongs to, and an ellipsis there is worse
        // than a second line.
        let navigator = period.flatMap { period -> PeriodNavigator? in
            guard let start = period.start, let end = period.end else { return nil }
            return PeriodNavigator(
                label: l10n.periodRange(start: start, end: end, timeZone: model.householdTimeZone),
                canGoBack: (model.viewedPeriodIndex ?? 0) > 0,
                canGoForward: (model.viewedPeriodIndex ?? 0) < model.periods.count - 1,
                onBack: { model.navigatePeriod(by: -1) },
                onForward: { model.navigatePeriod(by: 1) }
            )
        }
        let title = Text(l10n.t("tab.summary"))
            .appFont(18, .bold)
            .foregroundStyle(Theme.ink)

        return Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    title
                    navigator
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack {
                    title
                    Spacer()
                    navigator
                }
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

            Text(MoneyFormatter.aud(remainingCents, locale: l10n.locale))
                .amountStyle(52, .bold)
                .kerning(-0.03 * 52)
                .foregroundStyle(state == .over ? Theme.red : Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)

            BudgetBar(
                state: state,
                fraction: budgetCents > 0 ? Double(spentCents) / Double(budgetCents) : 0
            )

            HStack {
                RichText.text([
                    .init(
                        l10n.t("summary.spent") + " ",
                        color: Theme.inkSecondary, font: AppFont.font(13, .semibold)
                    ),
                    .init(
                        MoneyFormatter.aud(spentCents, locale: l10n.locale),
                        color: Theme.ink, font: AppFont.font(13, .bold)
                    ),
                    .init(
                        " " + l10n.t(
                            "summary.of",
                            MoneyFormatter.audCompact(budgetCents, locale: l10n.locale)
                        ),
                        color: Theme.inkSecondary, font: AppFont.font(13, .semibold)
                    ),
                ])
                .monospacedDigit()
                Spacer()
                if model.isViewingCurrentPeriod, let end = period.end {
                    let days = max(PeriodLogic.daysBetween(model.today, end) + 1, 0)
                    RichText.text([
                        .init(
                            daysLeftPrefix,
                            color: Theme.inkSecondary, font: AppFont.font(13, .semibold)
                        ),
                        .init(
                            l10n.daysCount(days),
                            color: Theme.ink, font: AppFont.font(13, .bold)
                        ),
                        .init(
                            daysLeftSuffix,
                            color: Theme.inkSecondary, font: AppFont.font(13, .semibold)
                        ),
                    ])
                    .monospacedDigit()
                }
            }

            if let carried = period.rolloverCents, carried != 0 {
                Text(l10n.t(
                    carried > 0 ? "summary.carriedOver" : "summary.carriedDeficit",
                    MoneyFormatter.aud(abs(carried), locale: l10n.locale)
                ))
                .appFont(11.5)
                .foregroundStyle(Theme.inkTertiary)
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

    // Strings rather than Texts now that the row is composed as one attributed
    // string. Not catalog keys on purpose: the count sits BETWEEN them, so the
    // sentence is assembled here rather than being one entry with a
    // placeholder.
    private var daysLeftPrefix: String { l10n.language == "es" ? "Quedan " : "" }
    private var daysLeftSuffix: String { l10n.language == "es" ? "" : " left" }

    /// Inset "PRESUPUESTO DEL PERÍODO $900 · Quincenal (por defecto)" row.
    private func budgetInsetRow(_ period: PeriodBudget) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text(l10n.t("summary.periodBudget").uppercased())
                    .appFont(11, .bold)
                    .kerning(11 * 0.05)
                    .foregroundStyle(Theme.inkTertiary)
                RichText.text([
                    .init(
                        MoneyFormatter.audCompact(period.amountCents, locale: l10n.locale),
                        color: Theme.ink, font: AppFont.font(14.5, .bold)
                    ),
                    .init(
                        " · \(l10n.t("period.\(period.period.rawValue)")) ",
                        color: Theme.ink, font: AppFont.font(14.5, .bold)
                    ),
                    .init(
                        period.isCustom ? l10n.t("source.custom") : l10n.t("source.default"),
                        color: Theme.inkTertiary, font: AppFont.font(14.5, .medium)
                    ),
                ])
                .monospacedDigit()
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

    // MARK: Spend readouts (this period · this month)

    /// Two cards, matching the web: what this period has consumed of its
    /// budget, and the calendar month regardless of period boundaries.
    private var spendCards: some View {
        HStack(alignment: .top, spacing: 10) {
            spendCard(
                title: l10n.t(period?.period == .weekly
                              ? "summary.spentThisWeek"
                              : "summary.spentThisFortnight"),
                cents: spentCents,
                over: state == .over,
                footnote: nil
            )
            monthCard
        }
    }

    @ViewBuilder
    private var monthCard: some View {
        if let cents = model.monthSpentCents {
            spendCard(
                title: l10n.t("summary.spentThisMonth"),
                cents: cents,
                over: false,
                // A period that began last month splits its spending across
                // two months, so this figure isn't the whole story.
                footnote: model.currentPeriodCrossesMonth
                    ? l10n.t("summary.periodCrossesMonth")
                    : nil
            )
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text(l10n.t("summary.spentThisMonth"))
                    .appFont(12.5, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                Text(l10n.t("summary.monthUnavailable"))
                    .appFont(13, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
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
    }

    private func spendCard(
        title: String,
        cents: Int,
        over: Bool,
        footnote: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .appFont(12.5, .semibold)
                .foregroundStyle(Theme.inkSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Text(MoneyFormatter.aud(cents, locale: l10n.locale))
                .amountStyle(26, .bold)
                .kerning(-0.03 * 26)
                .foregroundStyle(over ? Theme.red : Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let footnote {
                Text(footnote)
                    .appFont(10.5, .semibold)
                    .foregroundStyle(Theme.accentStrong)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
    }

    // MARK: Category breakdown

    private struct CategoryTotal: Identifiable {
        let id: String
        let category: Category
        let totalCents: Int
    }

    /// Synthetic bucket for expenses whose category was deleted (rendered
    /// with the gray "Otros" fallback, never dropped from the breakdown).
    private static let missingCategoryId = "__missing__"

    private var categoryTotals: [CategoryTotal] {
        guard let household = model.household else { return [] }
        var totals: [String: Int] = [:]
        for item in model.viewedExpenses {
            let id = household.categories[item.expense.categoryId] != nil
                ? item.expense.categoryId
                : Self.missingCategoryId
            totals[id, default: 0] += item.expense.amountCents
        }
        return totals.map { id, total in
            CategoryTotal(id: id, category: household.categories[id] ?? .missing, totalCents: total)
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
                                        if !entry.category.isBudgeted {
                                            Text(l10n.t("category.offBudget"))
                                                .appFont(10, .semibold)
                                                .foregroundStyle(Theme.inkTertiary)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 1)
                                                .background(Theme.fill)
                                                .clipShape(Capsule())
                                        }
                                        Spacer()
                                        amountText(entry.totalCents, size: 13.5)
                                    }
                                    MiniBar(
                                        color: Theme.categoryColor(id: entry.id, lightHex: entry.category.color),
                                        fraction: totalSpentCents > 0 ? Double(entry.totalCents) / Double(totalSpentCents) : 0
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
