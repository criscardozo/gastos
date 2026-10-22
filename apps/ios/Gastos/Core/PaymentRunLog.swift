import Foundation

/// A record, on the phone, of every time the Shortcuts payment action ran.
///
/// Diagnostic. The first real Wallet tap filed nothing and left no trace:
/// Shortcuts shows its result for a moment and keeps no history, and the
/// system log only reaches back a few hours. So each run writes down, before
/// doing anything else, what it was handed — and then how it ended. An empty
/// log after a payment is an answer too: the automation never reached the app.
///
/// Lives in the app's own defaults: `LogPaymentIntent` runs in the app
/// process, and Settings reads it back.
struct PaymentRunLog: Equatable {
    struct Entry: Codable, Equatable, Identifiable {
        var id: UUID
        var startedAt: Date
        /// What Shortcuts passed, verbatim; nil when the parameter came empty.
        var amount: String?
        var currency: String?
        var merchant: String?
        /// "running" until the run ends. Left as "running" means it never
        /// ended: iOS stopped the process mid-way.
        var outcome: String
    }

    static let running = "running"
    static let defaultsKey = "logPayment.runs"
    /// Enough to cover a few days of payments without growing forever.
    static let capacity = 20

    /// Newest first.
    private(set) var entries: [Entry]

    init(entries: [Entry] = []) {
        self.entries = Array(entries.prefix(Self.capacity))
    }

    mutating func start(_ entry: Entry) {
        entries.insert(entry, at: 0)
        if entries.count > Self.capacity { entries.removeLast(entries.count - Self.capacity) }
    }

    /// A finish for an entry that is no longer kept is dropped, not appended.
    mutating func finish(_ id: UUID, outcome: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].outcome = outcome
    }

    // MARK: Storage

    /// Unreadable data reads as an empty log rather than failing the payment.
    static func load(from defaults: UserDefaults) -> PaymentRunLog {
        guard let data = defaults.data(forKey: defaultsKey),
              let entries = try? JSONDecoder().decode([Entry].self, from: data)
        else { return PaymentRunLog() }
        return PaymentRunLog(entries: entries)
    }

    func save(to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        defaults.set(data, forKey: Self.defaultsKey)
    }
}
