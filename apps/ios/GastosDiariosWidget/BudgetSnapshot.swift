import Foundation

/// Mirror of the app's `WidgetBridge.Snapshot` (kept in sync by hand — the
/// widget shares no code with the app target). Written by the app to the
/// shared app-group UserDefaults whenever period/expense state changes.
struct BudgetSnapshot: Codable {
    var remainingCents: Int
    var budgetCents: Int
    /// "comfortable" | "warning" | "over".
    var state: String
    /// Inclusive period end, "YYYY-MM-DD" in the household timezone.
    var periodEndDate: String
    var currency: String
    /// IANA household timezone used for the days-left computation.
    var timezone: String
    var updatedAtEpoch: Int
    /// Daily AUD→USD rate for the bi-currency line; nil ⇒ AUD-only.
    /// Optional so a snapshot written by an older app build still decodes.
    var usdRate: Double?
    /// The user's active currency ("AUD" | "USD"); nil ⇒ AUD.
    var activeCurrency: String?

    static let appGroupId = "group.dev.cardozo.gastosdiarios"
    static let key = "budgetSnapshot"

    static func load() -> BudgetSnapshot? {
        guard let data = UserDefaults(suiteName: appGroupId)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(BudgetSnapshot.self, from: data)
    }

    /// Redacted-placeholder data (also used in the widget gallery preview).
    static var sample: BudgetSnapshot {
        let end = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return BudgetSnapshot(
            remainingCents: 28760,
            budgetCents: 90000,
            state: "comfortable",
            periodEndDate: formatter.string(from: end),
            currency: "AUD",
            timezone: TimeZone.current.identifier,
            updatedAtEpoch: Int(Date().timeIntervalSince1970),
            usdRate: 0.65,
            activeCurrency: "AUD"
        )
    }

    /// spent / budget, clamped to 0...1 (bar clamps at 100% per design).
    var spentFraction: Double {
        guard budgetCents > 0 else { return 0 }
        let fraction = Double(budgetCents - remainingCents) / Double(budgetCents)
        return min(max(fraction, 0), 1)
    }

    /// Days left in the period including today, computed in the household
    /// timezone; nil when the period already ended (stale snapshot).
    func daysLeft(now: Date = Date()) -> Int? {
        let parts = periodEndDate.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timezone) ?? .current
        guard let end = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        let todayStart = calendar.startOfDay(for: now)
        let endStart = calendar.startOfDay(for: end)
        let days = calendar.dateComponents([.day], from: todayStart, to: endStart).day ?? 0
        return days >= 0 ? days + 1 : nil
    }

    /// "$287,60" / "$287.60" via the widget's own locale; bare "$" like the
    /// design. Whole amounts drop decimals when `compact`.
    func formattedRemaining(compact: Bool = false) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = .autoupdatingCurrent
        formatter.currencySymbol = "$"
        let decimals = compact && remainingCents % 100 == 0 ? 0 : 2
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        let amount = NSDecimalNumber(value: remainingCents).dividing(by: 100)
        return formatter.string(from: amount) ?? "$0"
    }

    /// True when USD is the active currency AND a rate is available.
    private var usdIsPrimary: Bool {
        activeCurrency == "USD" && (usdRate ?? 0) > 0
    }

    /// Remaining in the ACTIVE currency — the widget's headline figure.
    func formattedRemainingPrimary(compact: Bool = false) -> String {
        guard usdIsPrimary, let rate = usdRate else {
            return formattedRemaining(compact: compact)
        }
        return Self.formatUSD(Double(remainingCents) / 100.0 * rate, compact: compact)
    }

    /// The other currency, shown small beneath the headline; nil ⇒ AUD-only
    /// (no rate), in which case the widget renders exactly as before.
    func formattedRemainingSecondary() -> String? {
        guard let rate = usdRate, rate > 0 else { return nil }
        if usdIsPrimary {
            return formattedRemaining()  // exact AUD anchor
        }
        return "≈ " + Self.formatUSD(Double(remainingCents) / 100.0 * rate)
    }

    private static func formatUSD(_ amount: Double, compact: Bool = false) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = .autoupdatingCurrent
        formatter.currencySymbol = "US$ "
        let decimals = compact && amount == amount.rounded() ? 0 : 2
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: amount)) ?? "US$ 0"
    }

    /// Whole-dollar short form for the Lock Screen circular family ("$288").
    var shortRemaining: String {
        let dollars = Int((Double(remainingCents) / 100.0).rounded())
        return "$\(dollars)"
    }
}
