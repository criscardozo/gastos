import XCTest

/// Checked against Cristian's real BBVA statement (closing 2026-08-27), because
/// the only way to know these numbers are right is to reproduce ones the bank
/// already printed. The TypeScript twin asserts exactly the same figures.
///
///   Consumos          UBER 34,33 · TEMU 342,43 · KMART 122,52
///                     DiDi 17,18 · DiDi 15,03        US$ 531,49
///   COMISION CUENTA FULL                            $  40.413,22
///   DB IVA $ 21%                                    $   8.486,78
///   IIBB PERCEP-CABA 2,00%( 48765,94 )              $     975,31
///   IVA RG 4240 21%( 48765,94 )                     $  10.240,84
///   DB.RG 5617 30% ( 804675,86 )                    $ 241.402,75
///   SALDO ACTUAL                                    $ 301.518,90
///
/// The two DiDi rides are the digital ones: 17,18 + 15,03 = 32,21, and
/// 32,21 × 1514 = 48.765,94 exactly — the base the statement prints for IIBB
/// and RG 4240. The rate falls out of the other base the same way:
/// 804.675,86 / 531,49 = 1514,00.
final class CardTaxesTests: XCTestCase {
    private let rate = 1514.0
    private let usdCents = 53_149
    private let digitalUsdCents = 3_221
    private let commissionArsCents = 4_041_322

    private func lines(
        usd: Int? = nil,
        digital: Int? = nil,
        commission: Int? = nil
    ) -> [CardTaxLine] {
        CardTaxes.lines(
            spend: StatementSpend(
                usdCents: usd ?? usdCents,
                digitalUsdCents: digital ?? digitalUsdCents
            ),
            rate: rate,
            commissionArsCents: commission ?? commissionArsCents,
            format: { "\($0)" }
        )
    }

    private func amount(_ prefix: String, in lines: [CardTaxLine]) -> Int? {
        lines.first { $0.label.hasPrefix(prefix) }?.arsCents
    }

    func testReproducesEveryLineToTheCent() {
        // No tolerance anywhere: the percepciones truncate and the fee's IVA
        // rounds, and applying that lands exactly on what the bank charged. A
        // tolerance here would hide the day that stops being true.
        let all = lines()
        XCTAssertEqual(amount("Comisión", in: all), 4_041_322)
        XCTAssertEqual(amount("DB IVA", in: all), 848_678)
        XCTAssertEqual(amount("IIBB", in: all), 97_531)
        XCTAssertEqual(amount("IVA RG 4240", in: all), 1_024_084)
        XCTAssertEqual(amount("DB.RG", in: all), 24_140_275)
    }

    func testAddsUpToTheBalanceTheStatementClosedOn() {
        // The rest of the peso side cancels out: the payment clears the previous
        // balance, and DEVOLUCION DE SALDOS clears the CR.RG 5617 refund. What
        // is left is these five lines, and they are the whole bill.
        XCTAssertEqual(CardTaxes.total(lines()), 30_151_890)
    }

    func testPrintsTheBasesTheStatementPrints() {
        XCTAssertEqual(CardTaxes.usdToArsCents(usdCents, rate: rate), 80_467_586)
        XCTAssertEqual(CardTaxes.usdToArsCents(digitalUsdCents, rate: rate), 4_876_594)
    }

    func testTaxesOnlyTheDigitalPartWithIibbAndRg4240() {
        // The heart of it. Uber, Temu and Kmart are 499,28 of the 531,49 and the
        // bank charged them neither line — so taxing the whole spend would have
        // overstated those two by fifteen times.
        let wholeSpendTaxed = lines(digital: usdCents, commission: 0)
        XCTAssertGreaterThan(amount("IIBB", in: wholeSpendTaxed) ?? 0, 97_531 * 15)
    }

    func testSaysNothingOnAnEmptyStatement() {
        XCTAssertTrue(lines(usd: 0, digital: 0, commission: 0).isEmpty)
    }

    func testChargesTheFeeEvenWithNothingSpent() {
        // Monthly, not per purchase.
        let all = lines(usd: 0, digital: 0)
        XCTAssertEqual(all.map(\.label), ["Comisión Cuenta Full", "DB IVA 21%"])
    }

    func testLeavesIibbAndRg4240OutOfAMonthWithNothingDigital() {
        // A statement of nothing but a Kmart run: RG 5617 still applies, because
        // it taxes all foreign spend, and the other two do not exist.
        let all = lines(usd: 12_252, digital: 0, commission: 0)
        XCTAssertEqual(all.map(\.label), ["DB.RG 5617 30%"])
    }

    func testKeepsTheStatementsOwnOrder() {
        XCTAssertEqual(lines().map(\.label), [
            "Comisión Cuenta Full",
            "DB IVA 21%",
            "IIBB PERCEP-CABA 2%",
            "IVA RG 4240 21%",
            "DB.RG 5617 30%",
        ])
    }

    func testTruncatesThePercepcionesAndRoundsTheFeesIva() {
        // Pinned on its own, because it is the one rule here derived from a
        // statement rather than from a percentage. US$ 1,01 at 1000,49 gives a
        // base of 1.010,49 (rounded from 1.010,4949); 2% of that is 20,2098,
        // which truncates to 20,20 rather than rounding to 20,21.
        let iibb = CardTaxes.lines(
            spend: StatementSpend(usdCents: 0, digitalUsdCents: 101),
            rate: 1000.49,
            commissionArsCents: 0,
            format: { "\($0)" }
        )
        XCTAssertEqual(iibb.first?.arsCents, 2_020)
        // 4.041.322 × 21% is 848.677,62, which rounds UP as the bank did.
        XCTAssertEqual(amount("DB IVA", in: lines(usd: 0, digital: 0)), 848_678)
    }

    func testConvertsIntegerCentsToIntegerCents() {
        XCTAssertEqual(CardTaxes.usdToArsCents(100, rate: rate), 151_400)
        XCTAssertEqual(CardTaxes.usdToArsCents(0, rate: rate), 0)
        // 1,00 at 1000,5 is 1000,50 — a whole cent, not a fraction.
        XCTAssertEqual(CardTaxes.usdToArsCents(100, rate: 1000.5), 100_050)
    }
}

/// The statement windows themselves.
final class CardLogicTests: XCTestCase {
    private func date(_ raw: String) -> CalendarDate { CalendarDate(raw)! }

    func testKeepsTheDayOfTheMonthAndClampsIt() {
        XCTAssertEqual(CardLogic.addMonthsKeepingDay(date("2026-01-27"), 1), date("2026-02-27"))
        // A statement closing on the 31st closes on the 28th in February;
        // rolling into March would move it into the wrong month entirely.
        XCTAssertEqual(CardLogic.addMonthsKeepingDay(date("2026-01-31"), 1), date("2026-02-28"))
        XCTAssertEqual(CardLogic.addMonthsKeepingDay(date("2026-12-27"), 1), date("2027-01-27"))
    }

    func testProposesTheNextStatementADayAfterTheLastOneCloses() {
        let previous = StatementRange(
            startDate: date("2026-07-28"),
            closingDate: date("2026-08-27"),
            dueDate: date("2026-09-07")
        )
        let next = CardLogic.nextStatementProposal(after: previous)
        // No charge can fall between two statements.
        XCTAssertEqual(next.startDate, date("2026-08-28"))
        XCTAssertEqual(next.closingDate, date("2026-09-27"))
        XCTAssertEqual(next.dueDate, date("2026-10-07"))
    }

    func testTheClosingDayItselfStillBelongsToTheStatement() {
        let statement = StatementRange(
            startDate: date("2026-07-28"),
            closingDate: date("2026-08-27"),
            dueDate: date("2026-09-10")
        )
        // The bank's own boundary is inclusive — a purchase on the 27th is on
        // this statement, which is why the range query uses <= closingDate.
        XCTAssertFalse(CardLogic.isPastClosing(today: date("2026-08-27"), statement: statement))
        XCTAssertTrue(CardLogic.isPastClosing(today: date("2026-08-28"), statement: statement))
        XCTAssertFalse(CardLogic.isPastClosing(today: date("2026-08-28"), statement: nil))
    }

    func testPullsTodayInsideTheWindowItIsFiledInto() {
        let statement = StatementRange(
            startDate: date("2026-07-28"),
            closingDate: date("2026-08-27"),
            dueDate: date("2026-09-10")
        )
        // A date outside the window would file the charge somewhere else — it
        // would be saved, and then not be there.
        XCTAssertEqual(CardLogic.clampToStatement(today: date("2026-09-05"), statement: statement),
                       date("2026-08-27"))
        XCTAssertEqual(CardLogic.clampToStatement(today: date("2026-07-01"), statement: statement),
                       date("2026-07-28"))
        XCTAssertEqual(CardLogic.clampToStatement(today: date("2026-08-11"), statement: statement),
                       date("2026-08-11"))
    }
}
