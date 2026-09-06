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

    /// A pending charge and the rule that claims it.
    struct ClaimedCharge: Identifiable, Equatable {
        let charge: BankCharge
        let rule: RecurringRuleDoc
        var id: String { charge.id }
    }

    /// Charges a rule can file without asking.
    var recurringReady: [ClaimedCharge] {
        claimed.filter { $0.rule.amountAudCents != nil }
    }

    /// Charges a rule claimed but cannot price — these need the one thing only
    /// a person knows, and stay pending until they say it.
    var recurringAsking: [ClaimedCharge] {
        claimed.filter { $0.rule.amountAudCents == nil }
    }

    private var claimed: [ClaimedCharge] {
        expenseBankCharges.compactMap { charge in
            guard let rule = RecurringRules.rule(
                for: charge.merchant, in: recurringRules
            ) else { return nil }
            return ClaimedCharge(charge: charge, rule: rule)
        }
    }

    /// What the on-open run watches.
    ///
    /// Both listeners feed this, and they do not answer together: gating on the
    /// rules alone fired the check while the charges were still in flight, so
    /// it found nothing, returned, and never ran again — the rule had filed
    /// nothing and said nothing about why. Keyed on both, it re-fires when
    /// either arrives.
    /// A latch, not a count.
    ///
    /// It included the number of pending charges at first, which the work
    /// itself changes: filing the first one moved the key, `.task(id:)`
    /// cancelled the run mid-flight, and the sheet was never shown — the
    /// expense was filed correctly and silently, which is the one thing the
    /// sheet exists to prevent. Exactly the bug the web hit in its own shape.
    /// This only ever goes false → true.
    var recurringInputsReady: Bool { recurringRulesLoaded && bankChargesLoaded }

    /// Whether it is worth interrupting on open at all. False while either
    /// listener is still in flight, because an empty list in flight looks
    /// exactly like nothing matching.
    var hasRecurringWork: Bool {
        recurringRulesLoaded && !(recurringReady.isEmpty && recurringAsking.isEmpty)
    }

    /// Run the rules once per launch, then offer the sheet.
    ///
    /// Only after the rules listener has answered: an empty list in flight is
    /// indistinguishable from "nothing matched", and this would conclude there
    /// was nothing to do a beat before the data arrived. The web hit exactly
    /// that, and this is the same guard.
    func runRecurringRulesIfNeeded() async {
        guard !offeredRecurringPrompt, recurringInputsReady, phase == .ready else { return }
        guard !recurringReady.isEmpty || !recurringAsking.isEmpty else { return }
        offeredRecurringPrompt = true
        let filed = recurringReady.count
        await fileAllReadyRecurring()
        recurringFiledCount = filed
        showRecurringPrompt = true
    }

    // MARK: Writes

    func fileRecurring(_ claim: ClaimedCharge, amountAudCents: Int) {
        guard let householdId = attachedHouseholdId, let uid = self.uid else { return }
        write { [firestore] in
            try await firestore.fileRecurringExpense(
                householdId: householdId,
                uid: uid,
                charge: claim.charge,
                rule: claim.rule,
                amountAudCents: amountAudCents
            )
        }
    }

    /// Files everything a rule can answer on its own, one batch at a time.
    ///
    /// Sequential rather than parallel: each is its own batch, and a burst of
    /// concurrent writes is how a free-tier quota disappears.
    func fileAllReadyRecurring() async {
        guard let householdId = attachedHouseholdId, let uid = self.uid else { return }
        for claim in recurringReady {
            guard let amount = claim.rule.amountAudCents else { continue }
            await awaitWrite { [firestore] in
                try await firestore.fileRecurringExpense(
                    householdId: householdId,
                    uid: uid,
                    charge: claim.charge,
                    rule: claim.rule,
                    amountAudCents: amount
                )
            }
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
