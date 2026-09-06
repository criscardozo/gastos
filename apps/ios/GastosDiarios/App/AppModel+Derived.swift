import Foundation

/// What the screens read: the current period, its totals, the split by member
/// and by category, and the lists a sheet works through.
///
/// An extension rather than a store, and only this section, because everything
/// here is COMPUTED. The rest of AppModel keeps `private(set)` on its state —
/// the compiler's guarantee that only the model mutates it — and Swift's
/// `private` is file-scoped, so moving a mutating section to another file would
/// mean opening every one of those setters to the whole module. Trading a
/// checked invariant for a shorter file is a bad deal; trading nothing for one
/// is not.
extension AppModel {
    // MARK: Derived

    var l10n: L10n { L10n.resolve(userLanguage: userProfile?.language) }

    var householdTimeZone: TimeZone {
        household?.timeZone ?? TimeZone(identifier: "Australia/Sydney")!
    }

    var today: CalendarDate {
        PeriodLogic.todayInTimezone(Date(), householdTimeZone)
    }

    var currentPeriod: PeriodBudget? {
        periods.last(where: { $0.contains(today) })
    }

    var currentPeriodIndex: Int? {
        guard let current = currentPeriod else { return nil }
        return periods.firstIndex(where: { $0.startDate == current.startDate })
    }

    var viewedPeriod: PeriodBudget? {
        guard let index = viewedPeriodIndex, periods.indices.contains(index) else {
            return currentPeriod
        }
        return periods[index]
    }

    var isViewingCurrentPeriod: Bool {
        viewedPeriod?.startDate == currentPeriod?.startDate
    }

    /// Ids of the categories that count towards the budget, or nil when they
    /// all do (the common case — no filter, no composite index needed).
    var budgetCategoryIds: [String]? {
        guard let categories = household?.categories else { return nil }
        guard categories.values.contains(where: { !$0.isBudgeted }) else { return nil }
        return categories.filter { $0.value.isBudgeted }.map(\.key)
    }

    /// True when the expense's category counts against the budget. A deleted
    /// category (no entry left) still counts — its spending really happened.
    func countsToBudget(_ expense: Expense) -> Bool {
        household?.categories[expense.categoryId]?.isBudgeted ?? true
    }

    /// Spending that actually consumes the current period's budget. Excluded
    /// categories stay in the lists and totals below, just not in this figure.
    var currentSpentCents: Int {
        currentExpenses
            .filter { countsToBudget($0.expense) }
            .reduce(0) { $0 + $1.expense.amountCents }
    }

    var currentRemainingCents: Int {
        (currentPeriod?.amountCents ?? 0) - currentSpentCents
    }

    var viewedSpentCents: Int {
        viewedExpenses
            .filter { countsToBudget($0.expense) }
            .reduce(0) { $0 + $1.expense.amountCents }
    }

    /// Everything spent in the viewed period, including excluded categories —
    /// used for the breakdown's proportions, not for the budget.
    var viewedTotalSpentCents: Int {
        viewedExpenses.reduce(0) { $0 + $1.expense.amountCents }
    }

    var currentBudgetState: BudgetState {
        PeriodLogic.budgetState(
            spentCents: currentSpentCents,
            budgetCents: currentPeriod?.amountCents ?? 0
        )
    }

    /// Expenses available for quick-entry suggestions — derived ONLY from what
    /// is already loaded in memory (current + viewed period), so it never adds
    /// an unbounded listener or extra reads. Deduped by document id.
    var suggestionExpenses: [Expense] {
        var seen = Set<String>()
        var result: [Expense] = []
        for item in currentExpenses + viewedExpenses {
            guard let id = item.expense.id else { continue }
            if seen.insert(id).inserted {
                result.append(item.expense)
            }
        }
        return result
    }

    var members: [(uid: String, profile: MemberProfile)] {
        guard let household else { return [] }
        return household.memberIds.compactMap { uid in
            household.memberProfiles[uid].map { (uid: uid, profile: $0) }
        }
    }

    /// First and last day of the month containing `today`, in the household
    /// timezone — a month rarely lines up with a weekly/fortnightly period.
    var currentMonthRange: (start: CalendarDate, end: CalendarDate)? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = householdTimeZone
        let parts = today.raw.split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]),
              let first = calendar.date(from: DateComponents(year: year, month: month, day: 1)),
              let lastDay = calendar.range(of: .day, in: .month, for: first)?.count,
              let start = CalendarDate(String(format: "%04d-%02d-01", year, month)),
              let end = CalendarDate(String(format: "%04d-%02d-%02d", year, month, lastDay))
        else { return nil }
        return (start, end)
    }

    /// True when the running period began before this month started, so part
    /// of its spending sits outside the month figure.
    var currentPeriodCrossesMonth: Bool {
        guard let monthStart = currentMonthRange?.start,
              let periodStart = currentPeriod?.start
        else { return false }
        return periodStart < monthStart
    }

    /// Past periods (before the current one), most recent first.
    var pastPeriods: [PeriodBudget] {
        guard let currentStart = currentPeriod?.startDate else {
            return periods.reversed()
        }
        return periods.filter { $0.startDate < currentStart }.reversed()
    }

}
