import Foundation

/// One expense as the last-month table on Servicios reads it.
struct ServicePayment: Equatable, Identifiable {
    let id: String
    let amountCents: Int
    let categoryId: String
    let note: String
    let date: String
    let usdCents: Int?

    init(id: String, amountCents: Int, categoryId: String, note: String, date: String, usdCents: Int?) {
        self.id = id
        self.amountCents = amountCents
        self.categoryId = categoryId
        self.note = note
        self.date = date
        self.usdCents = usdCents
    }

    init(_ expense: Expense) {
        self.init(
            id: expense.id ?? "", amountCents: expense.amountCents,
            categoryId: expense.categoryId, note: expense.note,
            date: expense.date, usdCents: expense.usdCents
        )
    }
}

/// Last month's Servicios payments: the table at the bottom of Servicios, for
/// "how much did the services cost us, exactly". The web's
/// lib/service-payments.ts; both run shared/service-payments-vectors.json.
enum ServicePayments {
    /// The calendar month before the one `today` falls in.
    static func previousMonth(today: CalendarDate) -> (start: CalendarDate, end: CalendarDate) {
        let first = PeriodLogic.monthRange(containing: today).start
        return PeriodLogic.monthRange(containing: PeriodLogic.addDays(first, -1))
    }

    /// Every Servicios expense in `rows` (already bounded to the month), by date
    /// then id — not only those naming a service on the register, because the
    /// question is what was paid — and their totals. The USD total is the
    /// bank's figure for the verified rows only; `unverified` says how many it
    /// leaves out.
    static func of(
        _ rows: [ServicePayment]
    ) -> (rows: [ServicePayment], totalAudCents: Int, totalUsdCents: Int, unverified: Int) {
        let paid = rows
            .filter { $0.categoryId == ServiceLogic.categoryId }
            .sorted { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
        let totalAud = paid.reduce(0) { $0 + $1.amountCents }
        let totalUsd = paid.reduce(0) { $0 + ($1.usdCents ?? 0) }
        let unverified = paid.filter { $0.usdCents == nil }.count
        return (paid, totalAud, totalUsd, unverified)
    }
}
