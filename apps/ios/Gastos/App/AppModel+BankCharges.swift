import Foundation

// The bank-charge half of AppModel, moved out of a 1094-line file. An extension
// of the same type in the same module, so this is identical at runtime — the
// point is that "what happens to a charge the bank reported" is now one file
// instead of a range somebody has to find.
//
// NOT extracted as its own @Observable store, which is what the plan entry
// suggested, because it is not self-contained: it reads `expenses`, `household`
// and `periods`. A store would have to own or duplicate those, and that changes
// lifecycle in an app two people use, verifiable only on a simulator here. The
// entry also says not to change behaviour while splitting; this honours that
// half and leaves the other for when the dependency is worth untangling on
// purpose.

@MainActor
extension AppModel {

    /// The bank's rate as the household's own verified expenses reveal it. Read
    /// from what is already in memory (current + viewed period), so it costs
    /// nothing — and it is what every suggestion is judged against.
    var learnedBankRate: Double? {
        BankMatch.learnRate(suggestionExpenses)
    }

    /// The charges this screen is concerned with: the debit card's, plus any
    /// whose card the household has not identified. A credit-card charge is not
    /// an expense waiting for its USD figure — it is a line on a card statement,
    /// and belongs to the web's Tarjetas screen. Until cards are configured in
    /// Ajustes this is every charge, exactly as it was before.
    ///
    /// Dismissed ones are still in here; `expenseBankCharges` is the pending
    /// half and `dismissedBankCharges` the recoverable one.
    private var myBankCharges: [BankCharge] {
        guard let household else { return bankCharges }
        return bankCharges.filter { household.belongsToExpenses(cardLast4: $0.cardLast4) }
    }

    /// Waiting to be matched — what the sheet works through.
    var expenseBankCharges: [BankCharge] {
        BankChargeInbox.partition(myBankCharges, now: Date()).pending
    }

    /// Discarded in the last 48 hours, newest first: still one press from
    /// coming back. Past the window they are swept, so this list empties itself.
    var dismissedBankCharges: [BankCharge] {
        // A charge that BECAME an expense carries the same `dismissedAt` as
        // one somebody threw away, so it appeared here with the same
        // "Restaurar" — which only clears the stamp. Pressing it returned the
        // charge to pending and left the expense: the same purchase counted
        // twice, with nothing on screen saying so.
        //
        // Told apart by the expense's id, which filing derives from the
        // charge, so nothing had to be stored. The way back for a filed charge
        // is the undo on the expense row, which deletes both.
        let filed = Set(suggestionExpenses.compactMap(\.filedFromChargeId))
        return BankChargeInbox.partition(myBankCharges, now: Date())
            .dismissed
            .filter { !filed.contains($0.id) }
    }

    /// One suggestion per pending charge, matched against the expenses already
    /// loaded — which is where a charge from the last day or two lands.
    var bankChargeSuggestions: [BankMatch.Suggestion] {
        BankMatch.suggestMatches(
            charges: expenseBankCharges,
            expenses: suggestionExpenses,
            referenceRate: learnedBankRate
        )
    }

    /// The unverified expenses a charge may be assigned to, most recent first.
    var unverifiedExpenses: [Expense] {
        suggestionExpenses
            .filter { !$0.isVerified }
            .sorted { ($0.date, $0.createdAt ?? .distantPast) > ($1.date, $1.createdAt ?? .distantPast) }
    }

    /// Confirm a suggestion: the expense takes the charge's USD and the charge
    /// leaves the list, in one batch.
    func assignBankCharge(_ charge: BankCharge, to expenseId: String) {
        guard let householdId = attachedHouseholdId, !charge.id.isEmpty else { return }
        write {
            try await self.firestore.assignBankCharge(
                householdId: householdId,
                chargeId: charge.id,
                expenseId: expenseId,
                usdCents: charge.usdCents
            )
        }
    }

    /// The Apps Script web app that runs the ingestion, from Info.plist.
    /// nil when it is not configured, which hides the button rather than
    /// offering one that cannot work.
    static let ingestEndpoint: URL? = {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "GDIngestURL") as? String,
              !raw.isEmpty,
              let url = URL(string: raw)
        else { return nil }
        return url
    }()


    /// Discard a charge that is not ours to match. Recoverable for 48 hours —
    /// which is why there is no confirmation prompt on the way in.
    func discardBankCharge(_ charge: BankCharge) {
        guard let householdId = attachedHouseholdId, !charge.id.isEmpty else { return }
        write {
            try await self.firestore.dismissBankCharge(
                householdId: householdId,
                chargeId: charge.id
            )
        }
    }

    /// Undo a discard: the charge goes back to the pending list.
    func restoreBankCharge(_ charge: BankCharge) {
        guard let householdId = attachedHouseholdId, !charge.id.isEmpty else { return }
        write {
            try await self.firestore.restoreBankCharge(
                householdId: householdId,
                chargeId: charge.id
            )
        }
    }

}
