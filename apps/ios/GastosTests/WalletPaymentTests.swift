import XCTest

/// What the Shortcuts payment action decides on its own: the amount, the note
/// and the category a person would otherwise have picked in the form.
final class WalletPaymentTests: XCTestCase {
    private func amount(_ text: String, _ code: String = "AUD") -> Result<Int, WalletPayment.Refusal> {
        WalletPayment.amountCents(Decimal(string: text)!, currencyCode: code, householdCurrency: "AUD")
    }

    func testAmountsBecomeHouseholdCents() {
        XCTAssertEqual(amount("7.98"), .success(798))
        XCTAssertEqual(amount("40"), .success(4000))
        // Rounded, not truncated: 0.005 is a fraction of a cent the bank
        // never charges, but a Decimal that arrives as 12.345 must not lose one.
        XCTAssertEqual(amount("12.345"), .success(1235))
        XCTAssertEqual(amount("3.5", "aud"), .success(350))
        XCTAssertEqual(amount("3.5", ""), .success(350), "a bare number is the household's currency")
    }

    func testRefusesWhatIsNotAnAudSpend() {
        XCTAssertEqual(amount("10", "USD"), .failure(.foreignCurrency("USD")))
        XCTAssertEqual(amount("0"), .failure(.notASpend))
        XCTAssertEqual(amount("-12.50"), .failure(.notASpend))
        XCTAssertEqual(amount("100000.01"), .failure(.tooLarge))
        XCTAssertEqual(amount("100000"), .success(Limits.maxExpenseAmountCents))
    }

    private func parsed(_ text: String) -> String {
        switch WalletPayment.parseAmount(text) {
        case .success(let value): "\(value.amount) \(value.currencyCode)"
        case .failure(let refusal): "\(refusal)"
        }
    }

    func testReadsAmountsAsShortcutsWritesThem() {
        // The forms the Transaction trigger's Amount can take as text, and the
        // usual ways a person types one.
        XCTAssertEqual(parsed("$12.00"), "12 ", "a bare $ is the household's currency")
        XCTAssertEqual(parsed("A$12.00"), "12 AUD")
        XCTAssertEqual(parsed("12.00 AUD"), "12 AUD")
        XCTAssertEqual(parsed("AUD 8.53"), "8.53 AUD")
        XCTAssertEqual(parsed("12"), "12 ")
        XCTAssertEqual(parsed("12,50"), "12.5 ", "a comma with cents is the decimal mark")
        XCTAssertEqual(parsed("1,234.56"), "1234.56 ")
        XCTAssertEqual(parsed("1.234,56"), "1234.56 ")
        XCTAssertEqual(parsed("1,234"), "1234 ", "three digits after a lone comma are thousands")
        XCTAssertEqual(parsed("1.050"), "1050 ")
        XCTAssertEqual(parsed(" $8.53\n"), "8.53 ")
    }

    func testKeepsTheCurrencySoAForeignPaymentIsRefused() {
        XCTAssertEqual(parsed("US$8.53"), "8.53 USD")
        XCTAssertEqual(parsed("USD 8.53"), "8.53 USD")
        XCTAssertEqual(parsed("€5"), "5 EUR")
        XCTAssertEqual(parsed("£5.20"), "5.2 GBP")
        // Every other dollar is somebody else's. "CA$" used to read as AUD
        // because it contains "A$", and a symbol with no code ("¥1,500",
        // "NZ$12") came back with none, which is taken as the household's —
        // ¥1,500 would have been filed as $1,500 AUD.
        XCTAssertEqual(parsed("CA$12.00"), "12 CA$")
        XCTAssertEqual(parsed("NZ$12"), "12 NZ$")
        XCTAssertEqual(parsed("HK$30.50"), "30.5 HK$")
        XCTAssertEqual(parsed("S$9"), "9 S$")
        XCTAssertEqual(parsed("¥1,500"), "1500 JPY")
        XCTAssertEqual(parsed("₹250"), "250 ₹")
        // The household's own dollar, however it is written, still reads as AUD.
        XCTAssertEqual(parsed("A$12.00"), "12 AUD")
        XCTAssertEqual(parsed("AU$12.00"), "12 AUD")
        XCTAssertEqual(parsed("$12.00"), "12 ")
        guard case .success(let usd) = WalletPayment.parseAmount("USD 8.53") else { return XCTFail() }
        XCTAssertEqual(
            WalletPayment.amountCents(usd.amount, currencyCode: usd.currencyCode, householdCurrency: "AUD"),
            .failure(.foreignCurrency("USD"))
        )
    }

    func testRefundsReadAsNegativeAndTextWithoutDigitsIsRefused() {
        XCTAssertEqual(parsed("-$12.00"), "-12 ")
        XCTAssertEqual(parsed("($12.00)"), "-12 ")
        XCTAssertEqual(parsed(""), "unreadable(\"\")")
        XCTAssertEqual(parsed("Amount"), "unreadable(\"Amount\")")
    }

    func testNoteIsTheShopWithoutTheProcessor() {
        XCTAssertEqual(WalletPayment.note(forMerchant: "  SQ *BREADTOP TOWN HALL "), "Breadtop Town Hall")
        XCTAssertEqual(WalletPayment.note(forMerchant: "ZLR*Cafe Lulu"), "Cafe Lulu")
        XCTAssertEqual(WalletPayment.note(forMerchant: "Woolworths"), "Woolworths")
        XCTAssertEqual(WalletPayment.note(forMerchant: String(repeating: "a", count: 300)).count, Limits.maxNoteCharacters)
    }

    private let categories: [String: Category] = [
        "groceries": Category(key: "groceries", name: nil, icon: "x", color: "#000000", sortOrder: 0),
        "coffee": Category(key: "coffee", name: nil, icon: "x", color: "#000000", sortOrder: 1),
        "old": Category(key: nil, name: "Old", icon: "x", color: "#000000", sortOrder: 2, archived: true),
        "other": Category(key: "other", name: nil, icon: "x", color: "#000000", sortOrder: 9),
    ]

    private func expense(_ note: String, _ categoryId: String, _ date: String) -> Expense {
        Expense(amountCents: 100, categoryId: categoryId, note: note, date: date, createdBy: "u")
    }

    func testCategoryFollowsTheLastTimeThisShopWasFiled() {
        let history = [
            expense("Breadtop", "groceries", "2026-09-01"),
            expense("breadtop", "coffee", "2026-10-01"),
            expense("Woolworths", "groceries", "2026-10-02"),
        ]
        XCTAssertEqual(
            WalletPayment.categoryId(forNote: "Breadtop", expenses: history, categories: categories),
            .success("coffee")
        )
    }

    func testCategoryFallsBackToOther() {
        let history = [expense("Breadtop", "old", "2026-10-01")]
        XCTAssertEqual(
            WalletPayment.categoryId(forNote: "Breadtop", expenses: history, categories: categories),
            .success("other"),
            "an archived category takes nothing new"
        )
        XCTAssertEqual(
            WalletPayment.categoryId(forNote: "Nuevo", expenses: [], categories: categories),
            .success("other")
        )
        var noOther = categories
        noOther["other"] = nil
        XCTAssertEqual(
            WalletPayment.categoryId(forNote: "Nuevo", expenses: [], categories: noOther),
            .success("groceries")
        )
        XCTAssertEqual(
            WalletPayment.categoryId(forNote: "Nuevo", expenses: [], categories: [:]),
            .failure(.noCategory)
        )
    }
}
