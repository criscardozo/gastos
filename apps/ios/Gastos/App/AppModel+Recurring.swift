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

        init(charge: BankCharge, rule: RecurringRuleDoc, amountAudCents: Int?, estimated: Bool) {
            self.charge = charge
            self.rule = rule
            self.amountAudCents = amountAudCents
            self.estimated = estimated
        }

        init(_ claim: RecurringRules.RunPlan<BankCharge, RecurringRuleDoc>.Claim) {
            self.init(
                charge: claim.charge, rule: claim.rule,
                amountAudCents: claim.amountAudCents, estimated: claim.estimated
            )
        }
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

    /// What the view keys on, so the rules run again when a charge arrives.
    ///
    /// The ids rather than a count: filing a charge takes it out of the pending
    /// list, so a count goes back down and the work re-triggers itself. Ids
    /// change too — but a run with nothing fresh is a no-op, so a re-fire
    /// returns. That is the whole reason this hangs off `onChange` and not
    /// `.task(id:)`: `.task` CANCELS the previous run when its key moves, and
    /// filing moves this key. That is how an expense once got filed correctly
    /// and silently, with the sheet never shown.
    ///
    /// Charges only. The rules were in this key too, with a note saying that
    /// making a rule in Ajustes would then file the charge already waiting —
    /// which it never did: a run acts on charges that ARRIVE, and one already
    /// seen is not fresh. A new rule is applied to what is waiting by the rule
    /// sheet itself (`addRecurringRuleAndApply`).
    var recurringTrigger: String {
        guard recurringInputsReady else { return "" }
        return expenseBankCharges.map(\.id).joined(separator: ",")
    }

    /// Whether it is worth interrupting on open at all. False while either
    /// listener is still in flight, because an empty list in flight looks
    /// exactly like nothing matching.
    var hasRecurringWork: Bool {
        recurringRulesLoaded && !(recurringReady.isEmpty && recurringAsking.isEmpty)
    }

    /// Run the rules over whatever has not been through them yet, then report.
    ///
    /// Only after both listeners have answered: an empty list in flight is
    /// indistinguishable from "nothing matched". What is filed and what is
    /// asked is decided by `RecurringRules.planRun` — the same plan the web
    /// makes, held to the same shared vectors — and this only carries it out.
    func runRecurringRulesIfNeeded() async {
        guard recurringInputsReady, phase == .ready else { return }
        let plan = RecurringRules.planRun(
            pending: expenseBankCharges, rules: recurringRules,
            learnedRate: learnedBankRate,
            seen: evaluatedChargeIds, filed: filedChargeIds
        )
        guard !plan.fresh.isEmpty else { return }
        // Both marked BEFORE the writes: the listener fires again the moment
        // the first expense lands, and a mark set afterwards would let that
        // run start the same charges over.
        evaluatedChargeIds.formUnion(plan.fresh)
        filedChargeIds.formUnion(plan.file.map(\.charge.id))
        guard !plan.file.isEmpty || !plan.ask.isEmpty else { return }

        // The questions are CAPTURED, not read live by the sheet. Read live,
        // answering one took its charge out of the list while the sheet moved
        // its index forward, so the next question slid into the slot just
        // passed: with two to answer, the second was never asked. Measured in
        // the Simulator — two Café charges, the first answered, the sheet said
        // "Listo" and the second sat pending with no expense.
        for claim in plan.ask.map(ClaimedCharge.init)
        where !recurringAskQueue.contains(where: { $0.id == claim.id }) {
            recurringAskQueue.append(claim)
        }
        for claim in plan.file.map(ClaimedCharge.init) {
            guard let amount = claim.amountAudCents else { continue }
            await fileOneRecurring(claim, amountAudCents: amount)
            // Appended as each lands rather than assigned at the end: if a
            // second batch arrives while this loop runs, the sheet must name
            // both, not whichever run finished last.
            if !recurringFiled.contains(where: { $0.id == claim.id }) {
                recurringFiled.append(claim)
            }
        }
        showRecurringPrompt = true
    }

    /// The sheet closed: what it reported and asked is over. What was FILED
    /// is still remembered (`filedChargeIds`), which is what keeps an undo from
    /// being filed straight back; only the report and the queue reset, so the
    /// next sheet names what is new rather than everything since launch.
    func recurringPromptDismissed() {
        recurringFiled = []
        recurringAskQueue = []
    }

    // MARK: Writes

    func fileRecurring(
        _ claim: ClaimedCharge, amountAudCents: Int, estimated: Bool = false
    ) {
        guard let householdId = attachedHouseholdId, let uid = self.uid else { return }
        // Filed by this session, so an undo does not bring it straight back —
        // the planner would otherwise estimate it once a rate is known.
        filedChargeIds.insert(claim.charge.id)
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
