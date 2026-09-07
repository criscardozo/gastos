import Foundation

/// The ceilings the security rules enforce, mirrored so a screen can refuse
/// what the server would refuse.
///
/// The rules are the only boundary, so these numbers are not the check — they
/// are the check the USER gets to see. Without them the entry form accepts the
/// value, Firestore's local cache shows the expense saved, and a write-error
/// alert arrives a moment later for a typo the field could have swallowed.
/// That exact defect was found and fixed on the web (see MAX_AMOUNT_CENTS in
/// money.ts, whose comment describes it) and left standing here, which is why
/// `limits.test.ts` now reads BOTH clients and `firestore.rules` rather than
/// trusting three copies to stay equal.
enum Limits {
    /// `expenses`: amountCents > 0 && amountCents <= 10_000_000 ($100,000).
    static let maxExpenseAmountCents = 10_000_000

    /// `defaultBudget` and `periodBudgets`: amountCents <= 100_000_000.
    /// Ten times the ledger's ceiling because it is a fortnight of them.
    static let maxBudgetAmountCents = 100_000_000

    /// `expenses`: note.size() <= 200.
    static let maxNoteCharacters = 200

    /// `households`: name.size() <= 60. The web caps this in its settings
    /// screen; the rename field here never did.
    static let maxHouseholdNameCharacters = 60
}
