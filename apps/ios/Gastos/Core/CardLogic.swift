import Foundation

// MARK: - CardLogic
// Credit-card statements and the peso taxes they carry. NO Firebase here.
//
// The Swift twin of apps/web/src/lib/statements.ts and card-taxes.ts.
//
// A statement is a window with two dates that mean different things — the
// CLOSING date is the last day a charge enters it, the DUE date is the last day
// it can be paid. Charges are bucketed by their own date, exactly as expenses
// are bucketed into periods, so nothing has to be re-pointed when a statement
// is opened, corrected or deleted.

/// Which card a charge went on. Raw values match the Firestore contract.
enum CardBrand: String, Codable, CaseIterable, Sendable {
    case visa, mastercard

    var label: String {
        switch self {
        case .visa: return "Visa"
        case .mastercard: return "Mastercard"
        }
    }
}

/// A statement's window: when it starts, when it closes, when it is payable.
struct StatementRange: Equatable, Sendable {
    var startDate: CalendarDate
    var closingDate: CalendarDate
    var dueDate: CalendarDate
}

enum CardLogic {
    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private static func daysInMonth(year: Int, month: Int) -> Int {
        let date = utcCalendar.date(from: DateComponents(year: year, month: month, day: 1))!
        return utcCalendar.range(of: .day, in: .month, for: date)!.count
    }

    /// The same day of the month, `months` on, clamped to the target month's
    /// length. A statement closing on the 31st closes on the 28th in February;
    /// rolling into March would move it into the wrong month entirely.
    static func addMonthsKeepingDay(_ date: CalendarDate, _ months: Int) -> CalendarDate {
        let year = Int(date.raw.prefix(4))!
        let month = Int(date.raw.dropFirst(5).prefix(2))!
        let day = Int(date.raw.suffix(2))!
        let total = month - 1 + months
        let targetYear = year + Int(floor(Double(total) / 12))
        let targetMonth = ((total % 12) + 12) % 12 + 1
        let clamped = min(day, daysInMonth(year: targetYear, month: targetMonth))
        return CalendarDate(String(format: "%04d-%02d-%02d", targetYear, targetMonth, clamped))!
    }

    /// What to prefill the "close and open the next" dialog with: both dates
    /// one month on, keeping their day, and a window that starts the day after
    /// the statement being closed — so no charge can fall between two.
    ///
    /// A proposal, not a decision: the user confirms or overrides both dates,
    /// which is the point of asking at all (banks move these around).
    static func nextStatementProposal(after previous: StatementRange) -> StatementRange {
        StatementRange(
            startDate: PeriodLogic.addDays(previous.closingDate, 1),
            closingDate: addMonthsKeepingDay(previous.closingDate, 1),
            dueDate: addMonthsKeepingDay(previous.dueDate, 1)
        )
    }

    /// A first statement has no predecessor to chain from, so today seeds it:
    /// this calendar month, closing on its last day, payable on the 10th.
    static func firstProposal(today: CalendarDate) -> StatementRange {
        let year = Int(today.raw.prefix(4))!
        let month = Int(today.raw.dropFirst(5).prefix(2))!
        let last = daysInMonth(year: year, month: month)
        let dueMonth = month == 12 ? 1 : month + 1
        let dueYear = month == 12 ? year + 1 : year
        return StatementRange(
            startDate: CalendarDate(String(format: "%04d-%02d-01", year, month))!,
            closingDate: CalendarDate(String(format: "%04d-%02d-%02d", year, month, last))!,
            dueDate: CalendarDate(String(format: "%04d-%02d-10", dueYear, dueMonth))!
        )
    }

    /// Whether `today` has already passed the statement's closing date.
    ///
    /// When it has, a charge made today does NOT belong to this statement:
    /// charges are filed by their own date, so the screen would have to date it
    /// on the closing day to keep it visible — filing a September purchase into
    /// August. The honest answer is to close and open the next one.
    static func isPastClosing(today: CalendarDate, statement: StatementRange?) -> Bool {
        guard let statement else { return false }
        return today > statement.closingDate
    }

    /// Today, pulled inside a statement's window. A charge belongs to whichever
    /// statement contains its date, so a date outside the one on screen would
    /// file it somewhere else — it would be saved, and then not be there.
    static func clampToStatement(today: CalendarDate, statement: StatementRange?) -> CalendarDate {
        guard let statement else { return today }
        if today < statement.startDate { return statement.startDate }
        if today > statement.closingDate { return statement.closingDate }
        return today
    }
}

// MARK: - The peso side

/// One line of what the bank adds on top of the purchases, in ARS.
struct CardTaxLine: Identifiable, Equatable {
    /// Matches the wording on the statement, so the two can be compared.
    var label: String
    var arsCents: Int
    /// What it was computed from, for the "why is this number" question.
    var basis: String

    var id: String { label }
}

/// The statement's foreign spend, and the digital part of it.
struct StatementSpend: Equatable {
    var usdCents: Int
    var digitalUsdCents: Int
}

/// What the card statement adds on top of the purchases, in Argentine pesos.
///
/// The purchases are in USD but the bank bills the taxes in ARS, so this is the
/// one place in the app that converts. The ledger never does. What lives here
/// is an ESTIMATE of the peso side, shown so nobody is surprised by the bill.
///
/// TWO DIFFERENT BASES, and a real BBVA statement prints both: `DB.RG 5617`
/// falls on ALL foreign spend, while `IIBB PERCEP-CABA` and `IVA RG 4240` fall
/// only on digital services from abroad — on that statement, US$ 32,21 of
/// US$ 531,49. The bank decides which is which from how the merchant is
/// registered, so the app has to be told: `CardCharge.digital`, which defaults
/// to true.
///
/// ROUNDING. The percepciones TRUNCATE and the IVA on the fee ROUNDS — three
/// data points against one on the same statement, and applying it reproduces
/// every line and the total to the cent. See apps/web/src/lib/card-taxes.ts.
enum CardTaxes {
    static let ivaRate = 0.21
    static let iibbRate = 0.02
    static let rg4240Rate = 0.21
    static let rg5617Rate = 0.3

    /// ARS cents for `usdCents` at `rate` pesos per dollar.
    static func usdToArsCents(_ usdCents: Int, rate: Double) -> Int {
        Int((Double(usdCents) / 100 * rate * 100).rounded())
    }

    /// A percepción, truncated to the cent — see the rounding note above.
    private static func percepcion(_ baseArsCents: Int, _ rate: Double) -> Int {
        Int((Double(baseArsCents) * rate).rounded(.down))
    }

    /// The peso charges this statement will carry, in the statement's own
    /// order. Empty when there is no fee configured AND nothing was spent, so a
    /// fresh statement shows nothing rather than five zeroes.
    static func lines(
        spend: StatementSpend,
        rate: Double,
        commissionArsCents: Int,
        format: (Int) -> String
    ) -> [CardTaxLine] {
        var out: [CardTaxLine] = []

        if commissionArsCents > 0 {
            out.append(CardTaxLine(
                label: "Comisión Cuenta Full",
                arsCents: commissionArsCents,
                basis: "fija"
            ))
            out.append(CardTaxLine(
                label: "DB IVA 21%",
                arsCents: Int((Double(commissionArsCents) * ivaRate).rounded()),
                basis: "21% de \(format(commissionArsCents))"
            ))
        }

        // The digital subset, taxed twice over — and only when there IS one. A
        // month of nothing but a shop run carries neither line, as the bank does.
        if spend.digitalUsdCents > 0 {
            let digitalArs = usdToArsCents(spend.digitalUsdCents, rate: rate)
            out.append(CardTaxLine(
                label: "IIBB PERCEP-CABA 2%",
                arsCents: percepcion(digitalArs, iibbRate),
                basis: "2% de \(format(digitalArs))"
            ))
            out.append(CardTaxLine(
                label: "IVA RG 4240 21%",
                arsCents: percepcion(digitalArs, rg4240Rate),
                basis: "21% de \(format(digitalArs))"
            ))
        }

        if spend.usdCents > 0 {
            let spendArs = usdToArsCents(spend.usdCents, rate: rate)
            out.append(CardTaxLine(
                label: "DB.RG 5617 30%",
                arsCents: percepcion(spendArs, rg5617Rate),
                basis: "30% de \(format(spendArs))"
            ))
        }

        return out
    }

    /// Everything above, added up.
    static func total(_ lines: [CardTaxLine]) -> Int {
        lines.reduce(0) { $0 + $1.arsCents }
    }
}
