import Foundation

/// A record, on the phone, of every time the Shortcuts payment action ran.
///
/// Diagnostic. The first real Wallet tap filed nothing and left no trace:
/// Shortcuts shows its result for a moment and keeps no history, and the
/// system log only reaches back a few hours. So each run writes down, before
/// doing anything else, what it was handed — and then how it ended. An empty
/// log after a payment is an answer too: the automation never reached the app.
///
/// It is also the record of what arrived on its own: "Cargo del banco" logs
/// the BBVA notification's text verbatim here, so when a bank charge looks
/// wrong the words that produced it can be read back. Two "charges" with no
/// shop on 17/11/2026 were incoming transfers, and this log is what said so.
/// For that it keeps whole months — the current one and the one before —
/// rather than the last few runs (Cristian, 20/11/2026).
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
    /// A ceiling, not the rule: the rule is two calendar months. Twice a
    /// busy month's runs, so it only bites if something loops.
    static let capacity = 1000

    /// Newest first.
    private(set) var entries: [Entry]

    init(entries: [Entry] = []) {
        self.entries = Array(entries.prefix(Self.capacity))
    }

    mutating func start(_ entry: Entry, now: Date = Date(), calendar: Calendar = .current) {
        entries.insert(entry, at: 0)
        prune(now: now, calendar: calendar)
    }

    /// Keeps the current month and the one before it, whole; older runs go.
    mutating func prune(now: Date, calendar: Calendar) {
        let thisMonth = calendar.dateInterval(of: .month, for: now)?.start ?? now
        let cutoff = calendar.date(byAdding: .month, value: -1, to: thisMonth) ?? thisMonth
        entries.removeAll { $0.startedAt < cutoff }
        if entries.count > Self.capacity { entries.removeLast(entries.count - Self.capacity) }
    }

    /// Newest month first, each month's runs newest first.
    func byMonth(calendar: Calendar = .current) -> [(month: Date, entries: [Entry])] {
        var groups: [(month: Date, entries: [Entry])] = []
        for entry in entries {
            let month = calendar.dateInterval(of: .month, for: entry.startedAt)?.start ?? entry.startedAt
            if groups.last?.month == month {
                groups[groups.count - 1].entries.append(entry)
            } else {
                groups.append((month, [entry]))
            }
        }
        return groups
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
