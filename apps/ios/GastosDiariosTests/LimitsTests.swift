import XCTest

/// The entry fields refuse what the rules would refuse.
///
/// Not belt-and-braces: the rules are the boundary and they hold either way.
/// What these buy is the DIFFERENCE between a field that stops taking a digit
/// and a write that looks saved — Firestore's local cache shows a refused
/// expense as landed, so the alert arrives after the user has seen it appear.
///
/// `apps/web/src/lib/limits.test.ts` reads `Limits.swift` and `firestore.rules`
/// and fails if the three copies stop agreeing; this file is about the field
/// actually honouring them.
final class LimitsTests: XCTestCase {
    private func typed(_ keys: [KeypadKey], max: Int) -> AmountInput {
        var input = AmountInput()
        for key in keys { input.tap(key, max: max) }
        return input
    }

    private func digits(_ string: String) -> [KeypadKey] {
        string.map { $0 == "," ? .separator : .digit(Int(String($0))!) }
    }

    // MARK: The amount

    func testTheKeypadStopsAtTheCeilingTheRulesEnforce() {
        // $100,000.00 exactly is allowed; the rules say `<= 10_000_000`.
        let atTheLimit = typed(digits("100000"), max: Limits.maxExpenseAmountCents)
        XCTAssertEqual(atTheLimit.cents, Limits.maxExpenseAmountCents)

        // One more digit would make it a million, and does nothing.
        var past = atTheLimit
        past.tap(.digit(0), max: Limits.maxExpenseAmountCents)
        XCTAssertEqual(
            past.cents, Limits.maxExpenseAmountCents,
            "a key that crosses the rules' ceiling must do nothing"
        )
    }

    /// Seven digits was the old cap and it is a hundred times too generous.
    func testTheOldSevenDigitCapWasNotTheRulesCeiling() {
        let typedIn = typed(digits("9999999"), max: Limits.maxExpenseAmountCents)
        XCTAssertLessThanOrEqual(
            typedIn.cents, Limits.maxExpenseAmountCents,
            "the keypad used to reach 9.999.999,99 — a hundred times the ceiling"
        )
    }

    func testPastingPastTheCeilingIsRefusedToo() {
        // The expense form types into a TextField, so `setDisplay` is the path
        // the amount actually takes — capping only `tap` would leave it open.
        var input = AmountInput()
        input.setDisplay("100000", separator: ",", max: Limits.maxExpenseAmountCents)
        XCTAssertEqual(input.cents, Limits.maxExpenseAmountCents)

        input.setDisplay("200000", separator: ",", max: Limits.maxExpenseAmountCents)
        XCTAssertEqual(
            input.cents, Limits.maxExpenseAmountCents,
            "a pasted amount over the ceiling must leave the field as it was"
        )
    }

    func testABudgetIsAllowedTenTimesTheLedgersCeiling() {
        var budget = BudgetEntryAmount(maxCents: Limits.maxBudgetAmountCents)
        for key in digits("200000") { budget.tap(key) }
        XCTAssertEqual(
            budget.audCents, 20_000_000,
            "a budget over the expense ceiling is legal and must be typeable"
        )
    }

    /// The trap this refactor could have introduced.
    func testLoadingABudgetKeepsItsOwnCeiling() {
        var budget = BudgetEntryAmount(maxCents: Limits.maxBudgetAmountCents)
        budget.setAUDCents(90_000)
        for key in digits("200000") { budget.tap(key) }
        XCTAssertEqual(
            budget.maxCents, Limits.maxBudgetAmountCents,
            "filling an amount must not reset the ceiling to the stricter default"
        )
    }

    // MARK: The note

    func testTheNoteCeilingIsTheRulesOne() {
        // The field truncates at this number; the value itself is checked
        // against firestore.rules from the web suite.
        XCTAssertEqual(Limits.maxNoteCharacters, 200)
    }
}
