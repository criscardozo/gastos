import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// One-way app → widget data handoff: a tiny JSON snapshot of the current
/// period's budget written to the shared app-group UserDefaults. The widget
/// extension keeps its own mirror of this struct (it shares no code with
/// the app target) — keep both in sync by hand.
enum WidgetBridge {

    struct Snapshot: Codable, Equatable {
        var remainingCents: Int
        var budgetCents: Int
        /// "comfortable" | "warning" | "over" (BudgetState raw values).
        var state: String
        /// Inclusive period end, "YYYY-MM-DD" in the household timezone.
        var periodEndDate: String
        var currency: String
        /// IANA household timezone — lets the widget compute days left the
        /// same way the app does.
        var timezone: String
        var updatedAtEpoch: Int
        /// Daily AUD→USD rate for the bi-currency line; nil ⇒ AUD-only.
        /// Optional so an older snapshot still decodes.
        var usdRate: Double?
        /// The user's active currency ("AUD" | "USD"); nil ⇒ AUD.
        var activeCurrency: String?
    }

    static let snapshotKey = "budgetSnapshot"

    /// Writes (or clears, when nil) the snapshot and asks WidgetKit to
    /// re-render.
    static func publish(_ snapshot: Snapshot?) {
        guard let defaults = UserDefaults(suiteName: QuickEntryBridge.appGroupId) else { return }
        if let snapshot, let data = try? JSONEncoder().encode(snapshot) {
            defaults.set(data, forKey: snapshotKey)
        } else {
            defaults.removeObject(forKey: snapshotKey)
        }
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
