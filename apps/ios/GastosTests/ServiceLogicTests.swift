import XCTest

/// The register meeting the ledger. The TypeScript twin
/// (apps/web/src/lib/services.test.ts) asserts the same behaviour on the same
/// shapes — both sides have to agree about which expense paid which bill.
final class ServiceLogicTests: XCTestCase {
    private func date(_ raw: String) -> CalendarDate { CalendarDate(raw)! }

    private func service(
        id: String = "s1",
        name: String = "Netflix",
        aud: Int? = 2_299,
        usd: Int? = 1_499,
        interval: ServiceInterval = .monthly,
        dueDay: Int = 7,
        anchorMonth: Int? = nil
    ) -> ServiceDoc {
        ServiceDoc(
            docId: id,
            name: name,
            amountAudCents: aud,
            amountUsdCents: usd,
            interval: interval,
            dueDay: dueDay,
            anchorMonth: anchorMonth,
            paidWith: .credit,
            createdBy: "u1"
        )
    }

    private func expense(
        id: String = "e1",
        amountCents: Int = 2_299,
        categoryId: String = "services",
        note: String = "Netflix",
        date: String = "2026-09-07",
        usdCents: Int? = nil
    ) -> Expense {
        Expense(
            id: id,
            amountCents: amountCents,
            categoryId: categoryId,
            note: note,
            date: date,
            createdBy: "u1",
            usdCents: usdCents,
            verified: usdCents != nil
        )
    }

    private var insurance: ServiceDoc {
        service(id: "s2", name: "Seguro", aud: 60_000, usd: nil,
                interval: .quarterly, dueDay: 15, anchorMonth: 3)
    }

    // MARK: Due dates

    func testABillDueTodayIsDueToday() {
        // "On or after" matters: a bill due today is due today, not next month.
        let netflix = service(dueDay: 7)
        XCTAssertEqual(ServiceLogic.nextDueDate(netflix, today: date("2026-09-07")),
                       date("2026-09-07"))
        XCTAssertEqual(ServiceLogic.daysUntilDue(netflix, today: date("2026-09-07")), 0)
        XCTAssertEqual(ServiceLogic.nextDueDate(netflix, today: date("2026-09-08")),
                       date("2026-10-07"))
    }

    func testClampsTheDayIntoShorterMonths() {
        // Due "on the 31st" is due on the 28th of February — moving it into
        // March would report the wrong month entirely.
        let rent = service(dueDay: 31)
        XCTAssertEqual(ServiceLogic.nextDueDate(rent, today: date("2026-02-01")),
                       date("2026-02-28"))
    }

    func testAQuarterlyBillOnlyFallsDueInItsOwnMonths() {
        XCTAssertTrue(ServiceLogic.isDueInMonth(insurance, month: 9))
        XCTAssertTrue(ServiceLogic.isDueInMonth(insurance, month: 12))
        XCTAssertFalse(ServiceLogic.isDueInMonth(insurance, month: 10))
        // Monthly is due every month, whatever the anchor says.
        XCTAssertTrue(ServiceLogic.isDueInMonth(service(), month: 10))
    }

    // MARK: The link

    func testIgnoresCaseAndAccentsInTheName() {
        // The link is a name typed twice by a person; it has to survive that.
        XCTAssertEqual(ServiceLogic.nameKey("  Telefonía "), ServiceLogic.nameKey("telefonia"))
        XCTAssertNotEqual(ServiceLogic.nameKey("Luz"), ServiceLogic.nameKey("Gas"))
    }

    func testLinksAnExpenseToTheServiceWhoseNameItCarries() {
        let statuses = ServiceLogic.statuses(
            services: [service()], expenses: [expense(note: "netflix")], month: 9
        )
        XCTAssertEqual(statuses["s1"]?.charge?.id, "e1")
        XCTAssertEqual(statuses["s1"]?.differenceCents, 0)
    }

    func testIgnoresExpensesOutsideTheServicesCategory() {
        // Otherwise a note that happened to say "Netflix" in Ocio would mark the
        // bill as paid. The category is what makes the note mean something.
        let statuses = ServiceLogic.statuses(
            services: [service()],
            expenses: [expense(categoryId: "entertainment")],
            month: 9
        )
        XCTAssertNil(statuses["s1"]?.charge)
    }

    func testReportsWhatTheBillActuallyCameTo() {
        // 25,99 charged against 22,99 on file: the expense is the truth, and
        // the screen offers to move the service onto it.
        let statuses = ServiceLogic.statuses(
            services: [service()], expenses: [expense(amountCents: 2_599)], month: 9
        )
        XCTAssertEqual(statuses["s1"]?.differenceCents, 300)
    }

    func testHasNothingToCompareForAServiceQuotedOnlyInUsd() {
        // An AUD expense cannot contradict a USD-only figure, so the honest
        // answer is nil rather than a difference measured against zero.
        let statuses = ServiceLogic.statuses(
            services: [service(aud: nil)], expenses: [expense()], month: 9
        )
        XCTAssertNotNil(statuses["s1"]?.charge)
        XCTAssertNil(statuses["s1"]?.differenceCents)
    }

    func testPicksTheSameChargeWhateverOrderTheyArriveIn() {
        // Two charges in one month is a data problem, not a crash — but the
        // answer must not depend on the order the query returned them in.
        let charges = [
            expense(id: "b", amountCents: 2_599, date: "2026-09-20"),
            expense(id: "a", amountCents: 2_299, date: "2026-09-07"),
        ]
        XCTAssertEqual(
            ServiceLogic.statuses(services: [service()], expenses: charges, month: 9)["s1"]?.charge?.id,
            "a"
        )
        XCTAssertEqual(
            ServiceLogic.statuses(services: [service()], expenses: charges.reversed(), month: 9)["s1"]?.charge?.id,
            "a"
        )
    }

    func testIgnoresAnExpenseWithAnEmptyNote() {
        let statuses = ServiceLogic.statuses(
            services: [service()], expenses: [expense(note: "  ")], month: 9
        )
        XCTAssertNil(statuses["s1"]?.charge)
    }

    // MARK: The month's two figures

    func testCountsOnlyTheServicesThisMonthCharges() {
        // October: Netflix yes, the quarterly insurance no. A "per month"
        // average would put a twelfth of every bill into every month, which is
        // why it could never be reconciled against a real one.
        let services = [service(), insurance]
        let statuses = ServiceLogic.statuses(services: services, expenses: [], month: 10)
        let totals = ServiceLogic.monthTotals(services: services, statuses: statuses)
        XCTAssertEqual(totals.dueCount, 1)
        XCTAssertEqual(totals.dueAudCents, 2_299)
        XCTAssertEqual(totals.dueUsdCents, 1_499)
        XCTAssertEqual(totals.chargedCount, 0)
    }

    func testSeparatesWhatHasLandedFromWhatTheMonthCosts() {
        // Netflix came in at 25,99 rather than 22,99: due says what is on file,
        // charged says what the bank did, and they disagree on purpose.
        let services = [service(), insurance]
        let charges = [expense(amountCents: 2_599, usdCents: 1_700)]
        let statuses = ServiceLogic.statuses(services: services, expenses: charges, month: 9)
        let totals = ServiceLogic.monthTotals(services: services, statuses: statuses)
        XCTAssertEqual(totals.dueAudCents, 62_299)
        XCTAssertEqual(totals.chargedAudCents, 2_599)
        XCTAssertEqual(totals.chargedUsdCents, 1_700)
        XCTAssertEqual(totals.chargedCount, 1)
        XCTAssertEqual(totals.dueCount, 2)
    }

    func testDoesNotCountAChargeForAServiceNotDueThisMonth() {
        // A quarterly bill paid in the wrong month is somebody's mistake, not a
        // reason for the month's total to grow.
        let services = [service(), insurance]
        let charges = [expense(amountCents: 60_000, note: "Seguro")]
        let statuses = ServiceLogic.statuses(services: services, expenses: charges, month: 10)
        let totals = ServiceLogic.monthTotals(services: services, statuses: statuses)
        XCTAssertEqual(totals.chargedAudCents, 0)
        XCTAssertEqual(totals.dueAudCents, 2_299)
    }
}

// MARK: - Unmatched Servicios expenses

extension ServiceLogicTests {
    private func svc(_ id: String, _ name: String) -> ServiceDoc {
        var s = ServiceDoc(name: name, interval: .monthly, dueDay: 7, paidWith: .debit, createdBy: "u1")
        s.docId = id
        return s
    }

    private func exp(_ id: String, _ note: String, _ date: String, category: String = "services") -> Expense {
        var e = Expense(
            amountCents: 5000, categoryId: category, note: note, date: date, createdBy: "u1"
        )
        e.id = id
        return e
    }

    /// The reported case, verbatim: a service called "Internet Casa" paid with
    /// an expense noted "Amaysim Internet Casa", which is what the bill says.
    func testFindsTheExpenseWhoseNoteNamesNoService() {
        let out = ServiceLogic.unmatchedExpenses(
            services: [svc("s1", "Internet Casa"), svc("s2", "YouTube Premium")],
            expenses: [
                exp("e1", "Amaysim Internet Casa", "2026-09-13"),
                exp("e2", "YouTube Premium", "2026-09-07"),
            ]
        )
        XCTAssertEqual(out.map(\.id), ["e1"])
    }

    func testIgnoresExpensesOutsideServicios() {
        let out = ServiceLogic.unmatchedExpenses(
            services: [svc("s1", "Internet Casa")],
            expenses: [exp("e1", "Nafta", "2026-09-13", category: "transport")]
        )
        XCTAssertTrue(out.isEmpty)
    }

    func testMatchesTheSameWayTheLinkDoes() {
        let out = ServiceLogic.unmatchedExpenses(
            services: [svc("s1", "Internet Casa")],
            expenses: [exp("e1", "  internet casa  ", "2026-09-13")]
        )
        XCTAssertTrue(out.isEmpty)
    }

    /// The control: a function returning its input would pass the first test.
    func testReturnsNothingWhenEveryNoteNamesAService() {
        let out = ServiceLogic.unmatchedExpenses(
            services: [svc("s1", "Internet Casa")],
            expenses: [exp("e1", "Internet Casa", "2026-09-13")]
        )
        XCTAssertTrue(out.isEmpty)
    }
}
