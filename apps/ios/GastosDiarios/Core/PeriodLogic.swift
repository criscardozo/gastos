import Foundation

// MARK: - PeriodLogic
// Pure calendar-date / period arithmetic. NO Firebase imports here.
// Validated against shared/period-test-vectors.json (see PeriodLogicTests) —
// the TypeScript implementation in apps/web must pass the same vectors.

/// The type a period was created with. Raw values match the Firestore contract.
enum PeriodType: String, Codable, CaseIterable, Sendable {
    case weekly
    case fortnightly

    /// Period length in days.
    var lengthInDays: Int {
        switch self {
        case .weekly: return 7
        case .fortnightly: return 14
        }
    }
}

/// State of the budget progress bar (design: "Van bien" / "Queda poco" / "Se pasaron").
enum BudgetState: String, Sendable {
    case comfortable
    case warning
    case over
}

/// A calendar date as a zero-padded "YYYY-MM-DD" string — the wire format for
/// expense/period dates. Comparable via plain string comparison, which is
/// exactly why the zero-padded format is mandatory.
struct CalendarDate: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    let raw: String

    init?(_ raw: String) {
        guard CalendarDate.isValid(raw) else { return nil }
        self.raw = raw
    }

    fileprivate init(unchecked raw: String) {
        self.raw = raw
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard CalendarDate.isValid(raw) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Invalid calendar date string: \(raw)"
            ))
        }
        self.raw = raw
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(raw)
    }

    static func < (lhs: CalendarDate, rhs: CalendarDate) -> Bool {
        lhs.raw < rhs.raw
    }

    var description: String { raw }

    private static func isValid(_ raw: String) -> Bool {
        // YYYY-MM-DD with logical month/day ranges; calendar correctness is
        // guaranteed by construction everywhere else.
        guard raw.count == 10 else { return false }
        let parts = raw.split(separator: "-")
        guard parts.count == 3,
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let month = Int(parts[1]), let day = Int(parts[2]),
              Int(parts[0]) != nil,
              (1...12).contains(month), (1...31).contains(day)
        else { return false }
        return true
    }
}

enum PeriodLogic {

    /// Fixed calendar used for date arithmetic: proleptic Gregorian pinned to
    /// UTC so day-adds are pure calendar math, immune to any device timezone
    /// or DST transition.
    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private static func components(of date: CalendarDate) -> DateComponents {
        let parts = date.raw.split(separator: "-")
        return DateComponents(
            year: Int(parts[0])!,
            month: Int(parts[1])!,
            day: Int(parts[2])!
        )
    }

    private static func instant(of date: CalendarDate) -> Date {
        utcCalendar.date(from: components(of: date))!
    }

    private static func calendarDate(fromUTCInstant instant: Date) -> CalendarDate {
        let comps = utcCalendar.dateComponents([.year, .month, .day], from: instant)
        return format(year: comps.year!, month: comps.month!, day: comps.day!)
    }

    private static func format(year: Int, month: Int, day: Int) -> CalendarDate {
        CalendarDate(unchecked: String(format: "%04d-%02d-%02d", year, month, day))
    }

    // MARK: Arithmetic

    /// `date + days` (days may be negative).
    static func addDays(_ date: CalendarDate, _ days: Int) -> CalendarDate {
        let shifted = utcCalendar.date(byAdding: .day, value: days, to: instant(of: date))!
        return calendarDate(fromUTCInstant: shifted)
    }

    /// Signed day distance from `from` to `to` (`to - from`).
    static func daysBetween(_ from: CalendarDate, _ to: CalendarDate) -> Int {
        utcCalendar.dateComponents([.day], from: instant(of: from), to: instant(of: to)).day!
    }

    /// Inclusive end date of a period starting at `startDate`:
    /// `startDate + (7|14) - 1` days.
    static func periodEndDate(startDate: CalendarDate, period: PeriodType) -> CalendarDate {
        addDays(startDate, period.lengthInDays - 1)
    }

    /// Whether `date` falls inside the inclusive `[startDate, endDate]` range.
    static func containsDate(startDate: CalendarDate, endDate: CalendarDate, date: CalendarDate) -> Bool {
        startDate <= date && date <= endDate
    }

    /// The local calendar date of `instant` in `timezone` — never the device
    /// timezone, never UTC bucketing. This is the 23:30-in-Sydney fix.
    static func todayInTimezone(_ instant: Date, _ timezone: TimeZone) -> CalendarDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezone
        let comps = calendar.dateComponents([.year, .month, .day], from: instant)
        return format(year: comps.year!, month: comps.month!, day: comps.day!)
    }

    // MARK: Materialization

    /// An inclusive period date range produced by cascade materialization.
    struct PeriodRange: Equatable, Sendable {
        let startDate: CalendarDate
        let endDate: CalendarDate
    }

    /// Given the last materialized period (or nil → seed from `anchorDate`),
    /// the CURRENT default period type and today's date (already in the
    /// household timezone), returns the ordered list of periods to create so
    /// that today is covered. Empty when today is already covered or precedes
    /// the anchor.
    static func cascadeMaterialization(
        last: PeriodRange?,
        anchorDate: CalendarDate?,
        defaultPeriod: PeriodType,
        today: CalendarDate
    ) -> [PeriodRange] {
        var nextStart: CalendarDate
        if let last {
            guard today > last.endDate else { return [] }
            nextStart = addDays(last.endDate, 1)
        } else {
            guard let anchorDate, anchorDate <= today else { return [] }
            nextStart = anchorDate
        }

        var created: [PeriodRange] = []
        while true {
            let end = periodEndDate(startDate: nextStart, period: defaultPeriod)
            created.append(PeriodRange(startDate: nextStart, endDate: end))
            if today <= end { break }
            nextStart = addDays(end, 1)
        }
        return created
    }

    // MARK: Budget state

    /// Warning threshold: spent >= 85% of budget. Over: spent > budget.
    /// Integer math so the 85% boundary is exact (no float rounding).
    static func budgetState(spentCents: Int, budgetCents: Int) -> BudgetState {
        guard budgetCents > 0 else { return spentCents > 0 ? .over : .comfortable }
        if spentCents > budgetCents { return .over }
        if spentCents * 100 >= budgetCents * 85 { return .warning }
        return .comfortable
    }
}
