import Foundation

// MARK: - ServiceLogic
// Recurring bills — the "Servicios" register. NO Firebase imports here.
//
// The Swift twin of apps/web/src/lib/services.ts. Both sides answer the same
// two questions and must answer them identically: WHEN a bill falls due, and
// WHICH expense paid it.
//
// A stored due date would be wrong the moment the month turned, so a service
// stores a RULE (`dueDay` + `interval`, plus `anchorMonth` for anything less
// frequent than monthly) and the date is derived from today.
//
// The money is not here. A charged service is an ordinary expense in the
// `services` category whose note is the service's name; the link between the
// two is that name and it is not stored anywhere. See shared/schema.md.

/// How often a bill falls due. Raw values match the Firestore contract.
enum ServiceInterval: String, Codable, CaseIterable, Sendable {
    case monthly, bimonthly, quarterly, biannual, yearly

    /// Months between two consecutive due dates.
    var months: Int {
        switch self {
        case .monthly: return 1
        case .bimonthly: return 2
        case .quarterly: return 3
        case .biannual: return 6
        case .yearly: return 12
        }
    }
}

/// Which card the bill is charged to.
enum PaidWith: String, Codable, CaseIterable, Sendable {
    case debit, credit
}

/// Everything the due-date maths needs; the Firestore doc carries more.
protocol DueRule {
    var interval: ServiceInterval { get }
    /// 1...31. Clamped down in months that are shorter than it.
    var dueDay: Int { get }
    /// 1...12 — which month the cycle lands on. Nil when monthly.
    var anchorMonth: Int? { get }
}

enum ServiceLogic {
    /// The category an expense must be in to count as paying a service.
    static let categoryId = "services"

    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    /// Days in a 1-based (year, month).
    private static func daysInMonth(year: Int, month: Int) -> Int {
        let date = utcCalendar.date(from: DateComponents(year: year, month: month, day: 1))!
        return utcCalendar.range(of: .day, in: .month, for: date)!.count
    }

    /// `YYYY-MM-DD` for a (year, month, day), with the day clamped to the
    /// month's length. A bill due "on the 31st" is due on the 28th of
    /// February — moving it into March instead would report the wrong month.
    private static func clampedDate(year: Int, month: Int, day: Int) -> CalendarDate {
        let clamped = min(day, daysInMonth(year: year, month: month))
        return CalendarDate(String(format: "%04d-%02d-%02d", year, month, clamped))!
    }

    /// Whether a 1-based month is one this rule falls due in.
    static func isDueInMonth(_ rule: DueRule, month: Int) -> Bool {
        let step = rule.interval.months
        if step == 1 { return true }
        let anchor = rule.anchorMonth ?? 1
        return ((month - anchor) % step + step) % step == 0
    }

    /// The first due date on or after `today`. "On" matters: a bill due today
    /// is due today, not next month.
    ///
    /// Walks forward month by month rather than doing modular arithmetic in one
    /// shot, because the clamping makes the answer depend on each candidate
    /// month's length.
    static func nextDueDate(_ rule: DueRule, today: CalendarDate) -> CalendarDate {
        let step = rule.interval.months
        var year = Int(today.raw.prefix(4))!
        var month = Int(today.raw.dropFirst(5).prefix(2))!

        for _ in 0...step {
            if isDueInMonth(rule, month: month) {
                let candidate = clampedDate(year: year, month: month, day: rule.dueDay)
                if candidate >= today { return candidate }
            }
            month += 1
            if month > 12 {
                month = 1
                year += 1
            }
        }
        // Unreachable: a due month always occurs within one full cycle.
        return clampedDate(year: year, month: month, day: rule.dueDay)
    }

    /// Whole days from `today` to the next due date. 0 means "due today".
    static func daysUntilDue(_ rule: DueRule, today: CalendarDate) -> Int {
        PeriodLogic.daysBetween(today, nextDueDate(rule, today: today))
    }

    /// Case- and accent-insensitive comparison key for a name.
    ///
    /// The link between a service and the expense that paid it is the NAME,
    /// because that is the only thing a person types twice. "Telefonía" and
    /// "telefonia" are the same bill.
    static func nameKey(_ name: String) -> String {
        name
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es"))
    }
}

/// Where a service stands this month.
struct ServiceStatus: Equatable {
    /// Falls due in the month being looked at.
    var dueThisMonth: Bool
    /// The expense that paid it this month, when there is one.
    var charge: Expense?
    /// The expense disagrees with the amount on file. Nil when there is nothing
    /// to compare — no charge yet, or a service quoted only in USD, which an
    /// AUD expense cannot contradict.
    var differenceCents: Int?
}

/// This month's two figures.
struct ServiceMonthTotals: Equatable {
    /// What the month's services will cost, whether or not they have landed.
    var dueAudCents = 0
    var dueUsdCents = 0
    /// What has actually been charged so far, from the expenses.
    var chargedAudCents = 0
    var chargedUsdCents = 0
    /// How many of the month's services have been charged, out of how many.
    var chargedCount = 0
    var dueCount = 0
}

extension ServiceLogic {
    /// Which service each of this month's service expenses paid, and whether
    /// the amount on file still matches what was actually charged.
    ///
    /// `expenses` must already be limited to the month in question; this does
    /// not filter by date, so the caller decides which month "this month" is.
    static func statuses(
        services: [ServiceDoc],
        expenses: [Expense],
        month: Int
    ) -> [String: ServiceStatus] {
        var charges: [String: Expense] = [:]
        for expense in expenses {
            guard expense.categoryId == categoryId else { continue }
            let key = nameKey(expense.note)
            guard !key.isEmpty else { continue }
            // First one wins, by date then id, so two charges for the same
            // service in one month give a stable answer rather than whichever
            // arrived last.
            if let previous = charges[key] {
                // `id` is a @DocumentID and so optional; an empty string sorts
                // first, which is fine — it only ever breaks a same-date tie.
                let earlier = expense.date < previous.date
                    || (expense.date == previous.date && (expense.id ?? "") < (previous.id ?? ""))
                if !earlier { continue }
            }
            charges[key] = expense
        }

        var out: [String: ServiceStatus] = [:]
        for service in services {
            let charge = charges[nameKey(service.name)]
            let expected = service.amountAudCents
            let difference: Int? = {
                guard let charge, let expected else { return nil }
                return charge.amountCents - expected
            }()
            out[service.id] = ServiceStatus(
                dueThisMonth: isDueInMonth(service, month: month),
                charge: charge,
                differenceCents: difference
            )
        }
        return out
    }

    /// The two figures the screen leads with: what this month costs, and how
    /// much of it has already been charged.
    ///
    /// The due side counts the amount ON FILE for services that fall due; the
    /// charged side counts what the expenses say, so a bill that came in higher
    /// makes the two disagree on purpose.
    static func monthTotals(
        services: [ServiceDoc],
        statuses: [String: ServiceStatus]
    ) -> ServiceMonthTotals {
        var totals = ServiceMonthTotals()
        for service in services {
            guard let status = statuses[service.id], status.dueThisMonth else { continue }
            totals.dueCount += 1
            totals.dueAudCents += service.amountAudCents ?? 0
            totals.dueUsdCents += service.amountUsdCents ?? 0
            if let charge = status.charge {
                totals.chargedCount += 1
                totals.chargedAudCents += charge.amountCents
                totals.chargedUsdCents += charge.usdCents ?? 0
            }
        }
        return totals
    }

    /// Soonest due first, ties broken by name so the order never flickers.
    static func sortedByDueDate(_ services: [ServiceDoc], today: CalendarDate) -> [ServiceDoc] {
        services.sorted { a, b in
            let da = nextDueDate(a, today: today)
            let db = nextDueDate(b, today: today)
            if da != db { return da < db }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }
}
