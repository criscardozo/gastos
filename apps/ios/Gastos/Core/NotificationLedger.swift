import Foundation

/// Which ids are worth a notification: the ones this device has never seen.
///
/// The background refresh reads the bank's pending charges and the expenses
/// the rules filed, and has to tell "arrived since I last looked" from "was
/// already there". Firestore has no notion of "new to this phone", so the phone
/// keeps its own list of what it has seen — fed by the refresh AND by the app
/// being open, so nothing you already looked at comes back as a notification.
///
/// Pure, so the two rules that matter are tested rather than trusted:
/// - **No baseline, no announcement.** The first time a device ever looks, it
///   records everything and says nothing. Turning the alerts on must not dump
///   the last fifty charges on the lock screen.
/// - **Bounded.** The list keeps the most recent `cap` ids; an id old enough to
///   fall off is long out of the bank's window, which is capped at 50.
enum NotificationLedger {
    static let cap = 300

    /// `current` against `seen` (nil when this device has never looked).
    /// Returns what to announce, in `current`'s order, and the list to store.
    static func fresh(
        _ current: [String],
        seen: [String]?,
        cap: Int = NotificationLedger.cap
    ) -> (announce: [String], seen: [String]) {
        guard let seen else { return ([], bounded(unique(current), cap: cap)) }
        let known = Set(seen)
        let announce = unique(current).filter { !known.contains($0) }
        return (announce, bounded(seen + announce, cap: cap))
    }

    /// Record `ids` as seen without announcing anything — what the app does
    /// while it is open, and what starts the baseline when alerts are turned on.
    static func marking(_ ids: [String], seen: [String]?, cap: Int = NotificationLedger.cap) -> [String] {
        let known = Set(seen ?? [])
        return bounded((seen ?? []) + unique(ids).filter { !known.contains($0) }, cap: cap)
    }

    private static func unique(_ ids: [String]) -> [String] {
        var met = Set<String>()
        return ids.filter { !$0.isEmpty && met.insert($0).inserted }
    }

    private static func bounded(_ ids: [String], cap: Int) -> [String] {
        ids.count > cap ? Array(ids.suffix(cap)) : ids
    }
}
