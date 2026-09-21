import Foundation

/// What the recurring rules do when you come back.
///
/// There is no server to run this — Cloud Functions need the paid plan — so the
/// matching happens on whichever client opens first. That is not a workaround:
/// "tell me next time I come in" is exactly when a client is running, and the
/// charge sat in Firestore until then either way.
///
/// Two halves, and only one is automatic. A rule that carries an amount FILES
/// the charge and the app reports it afterwards; a rule without one can only
/// ask, and the charge stays pending until somebody answers. Nothing is filed
/// on a guess.
extension AppModel {

    /// A pending charge, the rule that claims it, and what to file it for.
    struct ClaimedCharge: Identifiable, Equatable {
        let charge: BankCharge
        let rule: RecurringRuleDoc
        /// Nil when neither the rule nor the learned rate can price it.
        let amountAudCents: Int?
        /// True when the amount is a division rather than a figure anybody
        /// stated.
        let estimated: Bool
        var id: String { charge.id }
    }

    /// Charges that can be filed: the rule states the amount, or the
    /// household's own verified pairs reveal the rate and it is worked out
    /// from the bank's USD.
    var recurringReady: [ClaimedCharge] {
        claimed.filter { $0.amountAudCents != nil }
    }

    /// What is left — a rule with no amount and nothing to estimate from,
    /// which happens only before anything has ever been verified.
    var recurringAsking: [ClaimedCharge] {
        claimed.filter { $0.amountAudCents == nil }
    }

    /// What one rule claims out of the charges waiting RIGHT NOW.
    ///
    /// Saving a rule used to change nothing until the app was next opened,
    /// which is exactly backwards: the way you make a rule is by seeing a
    /// charge you recognise and pressing the icon on it, so that charge is the
    /// first thing the rule should file. It sat in the pending list instead,
    /// and the rule looked like it had not worked.
    func claims(of rule: RecurringRuleDoc) -> [ClaimedCharge] {
        expenseBankCharges.compactMap { claim(charge: $0, under: [rule]) }
            .filter { $0.amountAudCents != nil }
    }

    private var claimed: [ClaimedCharge] {
        expenseBankCharges.compactMap { claim(charge: $0, under: recurringRules) }
    }

    private func claim(
        charge: BankCharge, under rules: [RecurringRuleDoc]
    ) -> ClaimedCharge? {
        guard let rule = RecurringRules.rule(for: charge.merchant, in: rules) else {
            return nil
        }
        if let stated = rule.amountAudCents {
            return ClaimedCharge(
                charge: charge, rule: rule, amountAudCents: stated, estimated: false
            )
        }
        let estimate = RecurringRules.estimateAudCents(
            usdCents: charge.usdCents, rate: learnedBankRate
        )
        return ClaimedCharge(
            charge: charge, rule: rule,
            amountAudCents: estimate, estimated: estimate != nil
        )
    }

    /// What the run watches.
    ///
    /// Both listeners feed this, and they do not answer together: gating on the
    /// rules alone fired the check while the charges were still in flight, so
    /// it found nothing, returned, and never ran again — the rule had filed
    /// nothing and said nothing about why.
    ///
    /// **This is a latch, and on its own it is not enough to watch.** It goes
    /// false → true once and then never changes, so anything keyed on it alone
    /// runs exactly once per launch. Measured, because that is what shipped: a
    /// rule that matched a charge exactly, with an amount on it, filed nothing
    /// for two days. The charge landed while the app was open, and returning
    /// from the background did not help either — only killing the app and
    /// opening it again did. See `recurringTrigger`, which is what the view
    /// actually watches; this stays as the half that says "the data is here".
    var recurringInputsReady: Bool { recurringRulesLoaded && bankChargesLoaded }

    /// What the view keys on, so the rules run again when something arrives.
    ///
    /// The ids rather than a count: filing a charge takes it out of the pending
    /// list, so a count goes back down and the work re-triggers itself. Ids
    /// change too — but the run is idempotent by `evaluatedChargeIds`, so a
    /// re-fire finds nothing new and returns. That is the whole reason this
    /// hangs off `onChange` and not `.task(id:)`: `.task` CANCELS the previous
    /// run when its key moves, and filing moves the key. That is how an
    /// expense once got filed correctly and silently, with the sheet never
    /// shown.
    ///
    /// The rules are in the key as well: making a rule in Ajustes for a charge
    /// that is already waiting should file it, and that path is otherwise only
    /// covered when the rule is made from the charge itself.
    var recurringTrigger: String {
        guard recurringInputsReady else { return "" }
        return expenseBankCharges.map(\.id).joined(separator: ",")
            + "|" + recurringRules.compactMap(\.docId).joined(separator: ",")
    }

    /// Whether it is worth interrupting on open at all. False while either
    /// listener is still in flight, because an empty list in flight looks
    /// exactly like nothing matching.
    var hasRecurringWork: Bool {
        recurringRulesLoaded && !(recurringReady.isEmpty && recurringAsking.isEmpty)
    }

    /// Run the rules over whatever has not been through them yet, then report.
    ///
    /// Only after the rules listener has answered: an empty list in flight is
    /// indistinguishable from "nothing matched", and this would conclude there
    /// was nothing to do a beat before the data arrived. The web hit exactly
    /// that, and this is the same guard.
    ///
    /// Runs whenever a charge or a rule arrives, not once per launch. A charge
    /// lands when the bank sends its email, which is almost never the moment
    /// somebody cold-starts the app.
    func runRecurringRulesIfNeeded() async {
        guard recurringInputsReady, phase == .ready else { return }
        let fresh = expenseBankCharges.filter { !evaluatedChargeIds.contains($0.id) }
        guard !fresh.isEmpty else { return }
        // Marked BEFORE the writes, like the web's latch and for the same
        // reason: the listener fires again the moment the first expense lands,
        // and a mark set afterwards would let that run start the same charges
        // over.
        evaluatedChargeIds.formUnion(fresh.map(\.id))

        // Everything a rule can file, not only what is new — but only ASK
        // about what is new.
        //
        // The two halves are not symmetric and the difference is measurable.
        // Filing is idempotent and always right: if a rule claims a charge and
        // something can price it, it belongs in the ledger, and a charge can
        // become filable AFTER it was first seen — filing one recurring expense
        // verifies it, which teaches the rate, which prices a charge that had
        // none. That happened in this very run: a "Cafe" rule with no amount
        // filed nothing on arrival and then could, once two Opal charges had
        // taught the rate. Restricted to fresh ids it would have waited for the
        // next launch for no reason.
        //
        // Asking is the opposite: re-opening a question somebody has already
        // postponed is the app nagging, so that half is `fresh` only.
        let ids = Set(fresh.map(\.id))
        let ready = recurringReady
        let asking = recurringAsking.filter { ids.contains($0.charge.id) }
        guard !ready.isEmpty || !asking.isEmpty else { return }

        let filed = ready.count
        for claim in ready {
            guard let amount = claim.amountAudCents else { continue }
            await fileOneRecurring(claim, amountAudCents: amount)
        }
        recurringFiledCount = filed
        showRecurringPrompt = true
    }

    // MARK: Writes

    func fileRecurring(
        _ claim: ClaimedCharge, amountAudCents: Int, estimated: Bool = false
    ) {
        guard let householdId = attachedHouseholdId, let uid = self.uid else { return }
        write { [firestore] in
            try await firestore.fileRecurringExpense(
                householdId: householdId,
                uid: uid,
                charge: claim.charge,
                rule: claim.rule,
                amountAudCents: amountAudCents,
                estimated: estimated
            )
        }
    }

    /// One claim, filed and awaited.
    ///
    /// Callers loop over this sequentially rather than firing them in
    /// parallel: each is its own batch, and a burst of concurrent writes is how
    /// a free-tier quota disappears.
    func fileOneRecurring(_ claim: ClaimedCharge, amountAudCents: Int) async {
        guard let householdId = attachedHouseholdId, let uid = self.uid else { return }
        await awaitWrite { [firestore] in
            try await firestore.fileRecurringExpense(
                householdId: householdId,
                uid: uid,
                charge: claim.charge,
                rule: claim.rule,
                amountAudCents: amountAudCents,
                estimated: claim.estimated
            )
        }
    }

    /// Save a rule and immediately file whatever it already recognises.
    func addRecurringRuleAndApply(
        pattern: String, categoryId: String, note: String, amountAudCents: Int?
    ) async {
        guard let householdId = attachedHouseholdId, let uid = self.uid else { return }
        var newId: String?
        await awaitWrite { [firestore] in
            newId = try await firestore.addRecurringRule(
                householdId: householdId, uid: uid, pattern: pattern,
                categoryId: categoryId, note: note, amountAudCents: amountAudCents
            )
        }
        guard let ruleId = newId else { return }
        // Built by hand rather than waiting for the listener: the charge the
        // rule was made from should be filed before the dialog is even closed.
        let rule = RecurringRuleDoc(
            docId: ruleId, pattern: pattern, categoryId: categoryId,
            note: note, amountAudCents: amountAudCents, createdBy: uid
        )
        for claim in claims(of: rule) {
            guard let amount = claim.amountAudCents else { continue }
            await awaitWrite { [firestore] in
                try await firestore.fileRecurringExpense(
                    householdId: householdId, uid: uid, charge: claim.charge,
                    rule: rule, amountAudCents: amount, estimated: claim.estimated
                )
            }
        }
    }

    /// A charge nobody had entered, filed as its own expense.
    func createExpenseFromCharge(
        _ charge: BankCharge,
        categoryId: String,
        note: String,
        amountAudCents: Int
    ) {
        guard let householdId = attachedHouseholdId, let uid = self.uid else { return }
        write { [firestore] in
            try await firestore.fileChargeAsExpense(
                householdId: householdId,
                uid: uid,
                charge: charge,
                categoryId: categoryId,
                note: note,
                amountAudCents: amountAudCents
            )
        }
    }

    func undoRecurring(expenseId: String) {
        guard let householdId = attachedHouseholdId,
              let chargeId = FirestoreService.chargeId(fromAutoExpense: expenseId)
        else { return }
        write { [firestore] in
            try await firestore.undoRecurringExpense(
                householdId: householdId,
                expenseId: expenseId,
                chargeId: chargeId
            )
        }
    }

    func addRecurringRule(
        pattern: String, categoryId: String, note: String, amountAudCents: Int?
    ) {
        guard let householdId = attachedHouseholdId, let uid = self.uid else { return }
        write { [firestore] in
            try await firestore.addRecurringRule(
                householdId: householdId, uid: uid, pattern: pattern,
                categoryId: categoryId, note: note, amountAudCents: amountAudCents
            )
        }
    }

    func updateRecurringRule(
        _ ruleId: String,
        pattern: String, categoryId: String, note: String, amountAudCents: Int?
    ) {
        guard let householdId = attachedHouseholdId else { return }
        write { [firestore] in
            try await firestore.updateRecurringRule(
                householdId: householdId, ruleId: ruleId, pattern: pattern,
                categoryId: categoryId, note: note, amountAudCents: amountAudCents
            )
        }
    }

    func deleteRecurringRule(_ ruleId: String) {
        guard let householdId = attachedHouseholdId else { return }
        write { [firestore] in
            try await firestore.deleteRecurringRule(
                householdId: householdId, ruleId: ruleId
            )
        }
    }
}
