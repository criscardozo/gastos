import Foundation

/// Recurring-expense rules: a merchant pattern the household recognises, and
/// what to file it as when the bank reports it.
///
/// The Swift twin of `apps/web/src/lib/recurring.ts`; both must pass every case
/// in `shared/recurring-vectors.json`.
///
/// Distinct from `services` on purpose, and the difference is what triggers
/// them. A service is SCHEDULED — Netflix on the 7th, the insurance every
/// quarter — and its screen asks whether this month's has arrived. A rule here
/// is not scheduled at all: an Opal top-up happens when it happens, and what
/// fires it is the charge landing.
///
/// It runs on the CLIENT, next time one opens, because there is no server
/// (Cloud Functions need the paid plan). Not a compromise: "tell me next time I
/// come in" is exactly when a client is running.
enum RecurringRules {

    /// Lowercase, unaccented. The same folding the bank matcher uses.
    static func fold(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(
                options: [.diacriticInsensitive, .caseInsensitive],
                locale: Locale(identifier: "en_US_POSIX")
            )
    }

    /// Does this pattern claim this merchant?
    ///
    /// With no `*` it matches as a SUBSTRING, because that is how a person
    /// writes one: typing "Opal" to catch "OPAL AUCKLAND ST" is the obvious
    /// intent, and requiring an anchor would make the common case the fiddly
    /// one. A `*` is what tightens it — "Opal*" anchors the start, "*TOPUP" the
    /// end. NOT a regular expression: every other character is literal, so a
    /// merchant with a `+` or a `.` in it can be matched by typing it.
    ///
    /// An empty pattern, or one made only of stars, matches NOTHING. Left to
    /// the general rule it would claim every charge that ever arrives, which is
    /// the one outcome a rule must never have.
    static func matches(pattern: String, merchant: String) -> Bool {
        let p = fold(pattern)
        let m = fold(merchant)
        guard !p.isEmpty, !m.isEmpty else { return false }
        guard p.contains(where: { $0 != "*" }) else { return false }

        let parts = p.components(separatedBy: "*")
        if parts.count == 1 { return m.contains(parts[0]) }

        let first = parts[0]
        let last = parts[parts.count - 1]
        let middle = parts.dropFirst().dropLast()

        var cursor = m.startIndex
        if !first.isEmpty {
            guard m.hasPrefix(first) else { return false }
            cursor = m.index(m.startIndex, offsetBy: first.count)
        }
        for piece in middle where !piece.isEmpty {
            guard let found = m.range(of: piece, range: cursor..<m.endIndex) else {
                return false
            }
            cursor = found.upperBound
        }
        if !last.isEmpty {
            guard m.hasSuffix(last) else { return false }
            // The tail has to sit after everything already consumed, so "A*B"
            // cannot be satisfied by one occurrence playing both parts.
            let tailStart = m.index(m.endIndex, offsetBy: -last.count)
            guard tailStart >= cursor else { return false }
        }
        return true
    }

    /// The AUD a charge probably was, when the rule does not say.
    ///
    /// The household's own verified pairs reveal the rate the bank uses
    /// (`BankMatch.learnRate`), so a charge a rule recognises can be filed at
    /// that rate instead of waiting for somebody to type a figure — which is
    /// what left charges hanging in the list.
    ///
    /// Nil when there is nothing to estimate from: no rate learned yet, a rate
    /// that is not a rate, or an estimate that would round to zero. Zero would
    /// read as an expense that cost nothing, and the rules refuse it anyway.
    static func estimateAudCents(usdCents: Int, rate: Double?) -> Int? {
        guard let rate, rate > 0 else { return nil }
        let cents = Int((Double(usdCents) / rate).rounded())
        return cents > 0 ? cents : nil
    }

    /// The rule that claims this charge, or nil.
    ///
    /// Ordered by how specific the pattern is — the longer one wins — and then
    /// by the pattern itself so the answer is the same on both clients.
    /// Deliberately NOT by document id: the two would agree on the id, but a
    /// reader cannot predict it, and "which rule fired" has to be something a
    /// person can work out from what they typed.
    static func rule<R: RecurringRuleLike>(
        for merchant: String,
        in rules: [R]
    ) -> R? {
        rules
            .filter { matches(pattern: $0.pattern, merchant: merchant) }
            .sorted {
                let a = fold($0.pattern)
                let b = fold($1.pattern)
                if a.count != b.count { return a.count > b.count }
                return a < b
            }
            .first
    }
}

extension RecurringRules {

    /// One run of the rules: what is new, what to file, what to ask.
    struct RunPlan<Charge: RecurringChargeLike, Rule: RecurringRuleLike> {
        struct Claim {
            let charge: Charge
            let rule: Rule
            /// Nil when neither the rule nor the learned rate can price it.
            let amountAudCents: Int?
            /// True when the amount is a division rather than a stated figure.
            let estimated: Bool
        }
        /// Pending charges nobody had put through a run yet. The caller adds
        /// these to its `seen` set whether or not anything else happens.
        var fresh: [String] = []
        /// Everything claimable and priceable this session has not filed yet.
        var file: [Claim] = []
        /// Claimed but unpriceable, and among the charges that just arrived.
        var ask: [Claim] = []
    }

    /// Plan one run of the recurring rules over the pending charges.
    ///
    /// The Swift twin of `planRecurringRun` in apps/web/src/lib/recurring.ts,
    /// held to the same `run` cases of shared/recurring-vectors.json. It used
    /// to be written twice with no vectors, inline in each client, and the two
    /// diverged twice in one day: this side filed only what had just arrived
    /// while the web filed everything claimable, and the web re-filed a charge
    /// somebody had just taken back with undo.
    ///
    /// A run happens only when a charge ARRIVES. A rule made for a charge
    /// already waiting is applied by the rule sheet
    /// (`addRecurringRuleAndApply`), not here. Filing and asking are
    /// asymmetric on purpose: file every priceable claim this session has not
    /// filed — a charge can become priceable after it was first seen, once
    /// filing another teaches the rate — but ask only about what just arrived,
    /// because re-opening a question somebody postponed is nagging.
    static func planRun<C: RecurringChargeLike, R: RecurringRuleLike>(
        pending: [C],
        rules: [R],
        learnedRate: Double?,
        seen: Set<String>,
        filed: Set<String>
    ) -> RunPlan<C, R> {
        let fresh = pending.filter { !seen.contains($0.id) }
        guard !fresh.isEmpty else { return RunPlan() }
        let freshIds = Set(fresh.map(\.id))
        var plan = RunPlan<C, R>(fresh: fresh.map(\.id))
        for charge in pending {
            guard let rule = rule(for: charge.merchant, in: rules) else { continue }
            let amount = rule.amountAudCents
                ?? estimateAudCents(usdCents: charge.usdCents, rate: learnedRate)
            let claim = RunPlan<C, R>.Claim(
                charge: charge, rule: rule, amountAudCents: amount,
                estimated: rule.amountAudCents == nil && amount != nil
            )
            if amount != nil {
                if !filed.contains(charge.id) { plan.file.append(claim) }
            } else if freshIds.contains(charge.id) {
                plan.ask.append(claim)
            }
        }
        return plan
    }
}

/// What the planner needs of a charge, for the same reason the rule side is a
/// protocol: `Core` must not depend on the Firestore model.
protocol RecurringChargeLike {
    var id: String { get }
    var merchant: String { get }
    var usdCents: Int { get }
}

/// What the matcher needs of a rule, so `Core` does not depend on the Firestore
/// model — the same reason `BankMatch` declares its own shapes.
protocol RecurringRuleLike {
    var pattern: String { get }
    /// Nil is the rule saying "ask me", and is not the same as zero.
    var amountAudCents: Int? { get }
}

/// A bank charge is what the planner plans over.
extension BankCharge: RecurringChargeLike {}
