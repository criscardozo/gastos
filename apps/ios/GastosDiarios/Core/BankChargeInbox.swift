import Foundation

/// The 48-hour window a dismissed bank charge can be taken back in.
///
/// Dismissing used to delete the document, which made "I discarded that by
/// mistake" unrecoverable: the charge was gone from Firestore and the ingestion
/// remembers the Gmail message id, so no future sweep would bring it back.
/// Instead a dismissal stamps `dismissedAt` and the charge merely stops being
/// pending — for 48 hours it can be restored, after which a client sweep
/// deletes it for real.
///
/// Matching a charge to an expense still deletes on the spot, and should:
/// reconciling is not a mistake anyone needs to take back, and a resurrected
/// charge would offer to verify an already-verified expense.
///
/// Pure: no Firebase, no SwiftUI. `now` is always passed in, never read from the
/// clock, so every case here is testable.
///
/// The TypeScript twin is `apps/web/src/lib/bank-charges.ts`. Unlike the period
/// arithmetic and the bank matcher, this pair shares no JSON vectors: "is this
/// stamp older than 48 hours" has no calendar edge cases for the two to
/// disagree about — the only thing they must agree on is the constant below.
enum BankChargeInbox {
    /// How long a dismissed charge stays recoverable.
    static let dismissWindowHours: Double = 48

    static var dismissWindow: TimeInterval { dismissWindowHours * 3600 }

    static func isPending(_ charge: BankCharge) -> Bool {
        charge.dismissedAt == nil
    }

    /// Past the window, so it should be deleted and must not be listed. Note
    /// this is `>=`: a charge dismissed exactly 48 hours ago is out, which keeps
    /// "recoverable for 48 hours" literally true.
    static func isExpired(_ charge: BankCharge, now: Date) -> Bool {
        guard let dismissedAt = charge.dismissedAt else { return false }
        return now.timeIntervalSince(dismissedAt) >= dismissWindow
    }

    /// Dismissed and still inside the window.
    static func isRecoverable(_ charge: BankCharge, now: Date) -> Bool {
        charge.dismissedAt != nil && !isExpired(charge, now: now)
    }

    struct Partition: Equatable {
        /// Never dismissed — the working list.
        var pending: [BankCharge] = []
        /// Dismissed within the window, newest dismissal first: the one most
        /// likely to have been a slip is the one at the top.
        var dismissed: [BankCharge] = []
        /// Past the window. Nobody renders these; the sweep deletes them.
        var expired: [BankCharge] = []
    }

    static func partition(_ charges: [BankCharge], now: Date) -> Partition {
        var result = Partition()
        for charge in charges {
            if charge.dismissedAt == nil {
                result.pending.append(charge)
            } else if isExpired(charge, now: now) {
                result.expired.append(charge)
            } else {
                result.dismissed.append(charge)
            }
        }
        result.dismissed.sort {
            ($0.dismissedAt ?? .distantPast) > ($1.dismissedAt ?? .distantPast)
        }
        return result
    }
}
