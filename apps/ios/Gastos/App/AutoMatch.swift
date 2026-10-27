import Foundation
import os

/// Verifies, without asking, what `BankMatch.confidentMatches` is sure of.
///
/// One purchase reaches the phone twice, seconds apart: Wallet's transaction
/// (the AUD, filed as an expense by "Cargar pago") and the BBVA app's
/// notification (the USD, filed as a bank charge by "Cargo del banco"). Either
/// may run first, so BOTH actions run this after filing, and whichever runs
/// second finds the pair. The background refresh and the open app run it too,
/// for a run that timed out or was cut short.
///
/// Every write is the same batch as matching by hand (`assignBankCharge`), so
/// a match made here is undone the same way.
@MainActor
enum AutoMatch {
    struct Verified {
        let charge: BankCharge
        let expense: Expense
    }

    nonisolated private static let log = Logger(subsystem: "dev.cardozo.gastos", category: "autoMatch")

    /// Reads what it needs (cache allowed: an automation may run with no
    /// signal) and matches. Never throws: a failure here leaves the pair to the
    /// suggestion on screen, which is where it was before this existed.
    static func run(
        firestore: FirestoreService, householdId: String, household: Household,
        today: CalendarDate, timeout: Duration
    ) async -> [Verified] {
        let window = BankMatch.rateWindow(today: today)
        do {
            let charges = try await firestore.fetchBankCharges(householdId: householdId, source: .default)
            let expenses = try await firestore.fetchExpenses(
                householdId: householdId, startDate: window.start.raw, endDate: window.end.raw
            )
            let now = await apply(
                firestore: firestore, householdId: householdId, household: household,
                today: today, charges: charges, expenses: expenses, timeout: timeout
            )
            return now + alreadyMatched(charges: charges, expenses: expenses, except: now)
        } catch {
            log.notice("not run: \(String(describing: error), privacy: .public)")
            return []
        }
    }

    /// Pairs matched a moment before this read — by the open app, whose
    /// listeners run in the same process as a Shortcuts action and usually get
    /// there first. Without these the action said "saved" about an expense
    /// that was already verified. Told by the charge's stamp and the expense
    /// carrying exactly its USD on the same day.
    private static func alreadyMatched(
        charges: [BankCharge], expenses: [Expense], except: [Verified]
    ) -> [Verified] {
        let done = Set(except.map(\.charge.id))
        return charges.compactMap { charge in
            guard charge.assignedAt != nil, !done.contains(charge.id),
                  let expense = expenses.first(where: {
                      $0.isVerified && $0.usdCents == charge.usdCents && $0.date == charge.date
                  })
            else { return nil }
            return Verified(charge: charge, expense: expense)
        }
    }

    /// The matching over what the caller already read.
    static func apply(
        firestore: FirestoreService, householdId: String, household: Household,
        today: CalendarDate, charges: [BankCharge], expenses: [Expense], timeout: Duration
    ) async -> [Verified] {
        // The debit card's charges only: a credit-card one is a line on a card
        // statement, not the USD of an expense.
        let pending = BankChargeInbox.partition(charges, now: Date()).pending
            .filter { household.belongsToExpenses(cardLast4: $0.cardLast4) }
        let matches = BankMatch.confidentMatches(
            charges: pending, expenses: expenses,
            referenceRate: BankMatch.learnRate(expenses, asOf: today)
        )
        var verified: [Verified] = []
        // One at a time, like every other run: a burst of batches is how a
        // free-tier quota goes.
        for match in matches {
            guard let charge = pending.first(where: { $0.id == match.chargeId }),
                  let expense = expenses.first(where: { $0.id == match.expenseId })
            else { continue }
            do {
                let confirmed = try await firestore.assignBankChargeConfirmed(
                    householdId: householdId, chargeId: charge.id, expenseId: match.expenseId,
                    usdCents: charge.usdCents, timeout: timeout
                )
                log.notice("verified \(charge.id, privacy: .public) → \(match.expenseId, privacy: .public) confirmed=\(confirmed)")
                verified.append(Verified(charge: charge, expense: expense))
            } catch {
                // The other phone matched it first, or the rules refused it.
                log.notice("not verified \(charge.id, privacy: .public): \(String(describing: error), privacy: .public)")
            }
        }
        return verified
    }
}
