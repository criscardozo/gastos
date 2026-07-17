import XCTest
@testable import GastosDiarios

/// Bi-currency expense entry: `amountCents` is ALWAYS canonical AUD; a USD
/// entry additionally carries the original USD cents in the stored* fields.
/// Exercises the pure conversion logic on `BudgetEntryAmount` (the reused
/// entry model), independent of any SwiftUI view.
final class ExpenseCurrencyTests: XCTestCase {

    /// Builds a typed amount in the given currency with a known rate.
    private func amount(_ typed: Int, currency: BudgetEntryCurrency, rate: Double?) -> BudgetEntryAmount {
        var value = BudgetEntryAmount()
        value.rate = rate
        value.input = .fromCents(typed)
        value.currency = currency
        return value
    }

    func testAUDEntryStoresCanonicalAndOmitsOptionalFields() {
        let value = amount(1050, currency: .aud, rate: 0.653)
        XCTAssertEqual(value.audCents, 1050)
        XCTAssertNil(value.storedEntryCurrency)
        XCTAssertNil(value.storedEntryAmountCents)
    }

    func testUSDEntryConvertsToAUDAndKeepsOriginal() {
        // US$ 7.00 at 1 AUD = 0.65 USD → 700 / 0.65 = 1076.9 → 1077 AUD cents.
        let value = amount(700, currency: .usd, rate: 0.65)
        XCTAssertEqual(value.audCents, 1077)
        XCTAssertEqual(value.storedEntryCurrency, "USD")
        XCTAssertEqual(value.storedEntryAmountCents, 700)
    }

    func testUSDConversionRoundsToNearestCent() {
        // 1000 / 0.6666 = 1500.15 → rounds to 1500.
        XCTAssertEqual(amount(1000, currency: .usd, rate: 0.6666).audCents, 1500)
    }

    func testUSDWithoutRateFallsBackToAUDOnly() {
        // No rate (offline, empty cache): the USD input is treated as AUD and
        // the optional fields are omitted so the doc stays canonical.
        let value = amount(500, currency: .usd, rate: nil)
        XCTAssertEqual(value.audCents, 500)
        XCTAssertNil(value.storedEntryCurrency)
        XCTAssertNil(value.storedEntryAmountCents)
    }

    func testSwitchToUSDIsHiddenWithoutRate() {
        // switchTo forces AUD when no rate is available (the UI hides USD too).
        var value = BudgetEntryAmount()
        value.input = .fromCents(1000)
        value.switchTo(.usd)
        XCTAssertEqual(value.currency, .aud)
    }

    func testFromUSDCentsRestoresEditingState() {
        let value = BudgetEntryAmount.fromUSDCents(700, rate: 0.65)
        XCTAssertEqual(value.currency, .usd)
        XCTAssertEqual(value.input.cents, 700)
        XCTAssertEqual(value.storedEntryAmountCents, 700)
        XCTAssertEqual(value.audCents, 1077)
    }

    func testSetAUDCentsPreservesRateAndForcesAUD() {
        var value = amount(700, currency: .usd, rate: 0.65)
        value.setAUDCents(900)
        XCTAssertEqual(value.currency, .aud)
        XCTAssertEqual(value.audCents, 900)
        XCTAssertEqual(value.rate, 0.65)          // rate kept for later USD toggles
        XCTAssertNil(value.storedEntryCurrency)
    }
}
