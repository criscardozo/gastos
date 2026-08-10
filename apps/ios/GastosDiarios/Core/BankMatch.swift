import Foundation

/// Matching the bank's USD charges to the expenses they paid for.
///
/// The second implementation of `apps/web/src/lib/bank-match.ts`. Both are
/// validated against `shared/bank-match-vectors.json`, exactly as the period
/// arithmetic is — duplicated logic only stays honest when one file decides what
/// it does. Change the behaviour in the vectors first, then in both.
///
/// Three signals, in order of how much they actually tell us:
///
///  1. The rate. Every already-verified expense is an (AUD, USD) pair, so the
///     bank's rate is LEARNED from the household's own history (median, so one
///     odd pair cannot drag it). Once known, a charge's USD nearly determines
///     the AUD it came from — the strongest signal by far, and the reason the
///     app needs no FX API.
///  2. The merchant. The email names the establishment ("COLES 0831"), which
///     often appears in the expense note ("Coles").
///  3. The date. The authorisation lands the same day or a day or two later.
///
/// Nothing here writes anything: a suggestion is a proposal the user confirms.
enum BankMatch {

    /// Days apart beyond which a charge and an expense cannot be the same thing.
    static let maxDayGap = 3
    /// Relative rate error beyond which a pair is rejected outright.
    static let rateReject = 0.2
    /// Relative rate error that still scores above zero.
    static let rateTolerance = 0.1
    /// Without a learned rate, only these AUD→USD ratios are even plausible.
    static let plausibleRate = (min: 0.35, max: 1.0)
    /// Below this no suggestion is offered — the user picks by hand instead.
    static let minScore = 0.35

    struct Suggestion: Equatable {
        let chargeId: String
        /// Best unverified expense for this charge; nil when nothing fits.
        let expenseId: String?
        /// 0…1 — how much the three signals agree.
        let score: Double
        /// usd / aud for the suggested pair, for display beside the learned rate.
        let impliedRate: Double?
    }

    /// The bank's rate as the household's own verified expenses reveal it: the
    /// median of usd/aud over every pair already known. nil until there is one.
    static func learnRate(_ expenses: [Expense]) -> Double? {
        let rates = expenses
            .filter { $0.isVerified && $0.amountCents > 0 }
            .compactMap { expense -> Double? in
                guard let usd = expense.usdCents else { return nil }
                return Double(usd) / Double(expense.amountCents)
            }
            .sorted()
        guard !rates.isEmpty else { return nil }
        let mid = rates.count / 2
        return rates.count % 2 == 1 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2
    }

    /// Lowercase, unaccented, digit-free words of 3+ letters.
    static func tokens(_ text: String) -> Set<String> {
        let folded = text.folding(
            options: [.diacriticInsensitive, .caseInsensitive],
            locale: Locale(identifier: "en_US_POSIX")
        )
        // Keep only a–z, exactly as the TypeScript side does, so a merchant
        // written with digits or punctuation tokenizes identically.
        let letters = String(folded.map { char in
            ("a"..."z").contains(String(char)) ? char : " "
        })
        return Set(
            letters.split(separator: " ").map(String.init).filter { $0.count >= 3 }
        )
    }

    /// Token overlap, normalized by the shorter side so "Coles" ≈ "COLES 0831".
    static func merchantScore(merchant: String, note: String) -> Double {
        let a = tokens(merchant)
        let b = tokens(note)
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        let shared = a.intersection(b).count
        return Double(shared) / Double(Swift.min(a.count, b.count))
    }

    /// 1 for the same day, decaying to 0 past `maxDayGap`.
    static func dateScore(gap: Int) -> Double {
        switch gap {
        case 0: return 1
        case 1: return 0.7
        case 2: return 0.4
        default: return 0.2
        }
    }

    private struct Pair {
        let chargeId: String
        let expenseId: String
        let score: Double
        let impliedRate: Double
    }

    /// Rank every (charge, unverified expense) pair and hand each charge its
    /// best still-free expense. Greedy over the global ranking, so a confident
    /// pair claims its expense before a weaker pair can.
    ///
    /// `referenceRate` is what `learnRate` returned; nil falls back to the
    /// plausible-band check, which is all the very first charge can be judged on.
    static func suggestMatches(
        charges: [BankCharge],
        expenses: [Expense],
        referenceRate: Double?
    ) -> [Suggestion] {
        let candidates = expenses.filter { !$0.isVerified && $0.amountCents > 0 }
        var pairs: [Pair] = []

        for charge in charges {
            guard let chargeDate = CalendarDate(charge.date) else { continue }
            for expense in candidates {
                guard let expenseId = expense.id,
                      let expenseDate = CalendarDate(expense.date)
                else { continue }
                let gap = abs(PeriodLogic.daysBetween(chargeDate, expenseDate))
                if gap > maxDayGap { continue }

                let impliedRate = Double(charge.usdCents) / Double(expense.amountCents)
                let rateScore: Double
                if let referenceRate, referenceRate > 0 {
                    let error = abs(impliedRate / referenceRate - 1)
                    if error > rateReject { continue }
                    rateScore = Swift.max(0, 1 - error / rateTolerance)
                } else {
                    if impliedRate < plausibleRate.min || impliedRate > plausibleRate.max {
                        continue
                    }
                    // Nothing learned yet: the rate can only say "not impossible".
                    rateScore = 0.5
                }

                pairs.append(Pair(
                    chargeId: charge.id,
                    expenseId: expenseId,
                    score: 0.55 * rateScore
                        + 0.25 * merchantScore(merchant: charge.merchant, note: expense.note)
                        + 0.2 * dateScore(gap: gap),
                    impliedRate: impliedRate
                ))
            }
        }

        // Highest score first; ties broken by id so the output is deterministic.
        pairs.sort { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score > rhs.score }
            if lhs.chargeId != rhs.chargeId { return lhs.chargeId < rhs.chargeId }
            return lhs.expenseId < rhs.expenseId
        }

        var takenExpense = Set<String>()
        var best: [String: Pair] = [:]
        for pair in pairs {
            if best[pair.chargeId] != nil || takenExpense.contains(pair.expenseId) { continue }
            if pair.score < minScore { continue }
            best[pair.chargeId] = pair
            takenExpense.insert(pair.expenseId)
        }

        return charges.map { charge in
            let pair = best[charge.id]
            return Suggestion(
                chargeId: charge.id,
                expenseId: pair?.expenseId,
                score: pair?.score ?? 0,
                impliedRate: pair?.impliedRate
            )
        }
    }
}
