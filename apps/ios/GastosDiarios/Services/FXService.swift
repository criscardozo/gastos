import Foundation

/// Display-only FX (AUD → USD) via frankfurter.dev. Cached per calendar day in
/// UserDefaults; degrades silently to AUD-only when unavailable. Conversions
/// are NEVER persisted to Firestore.
@MainActor
final class FXService {

    private static let cacheKey = "fx.rate.AUD.USD"
    private static let cacheDayKey = "fx.rate.AUD.USD.day"

    private struct Response: Decodable {
        let rates: [String: Double]
    }

    /// Latest AUD→USD rate, from today's cache or the network. nil on failure.
    func audToUsdRate() async -> Double? {
        let today = Self.dayStamp()
        let defaults = UserDefaults.standard
        if defaults.string(forKey: Self.cacheDayKey) == today {
            let cached = defaults.double(forKey: Self.cacheKey)
            if cached > 0 { return cached }
        }

        guard let url = URL(string: "https://api.frankfurter.dev/v1/latest?base=AUD&symbols=USD") else {
            return nil
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let rate = try JSONDecoder().decode(Response.self, from: data).rates["USD"],
                  rate > 0
            else { return nil }
            defaults.set(rate, forKey: Self.cacheKey)
            defaults.set(today, forKey: Self.cacheDayKey)
            return rate
        } catch {
            // Silent AUD-only fallback: return yesterday's cache if any.
            let cached = defaults.double(forKey: Self.cacheKey)
            return cached > 0 ? cached : nil
        }
    }

    private static func dayStamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: Date())
    }
}
