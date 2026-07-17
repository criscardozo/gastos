import Foundation

/// Formats integer cents into display strings. Money is NEVER a float in the
/// data layer — Doubles only appear at the last formatting step.
enum MoneyFormatter {

    private static func formatter(locale: Locale, symbol: String, decimals: Int = 2) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = locale
        formatter.currencySymbol = symbol
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter
    }

    private static func decimal(fromCents cents: Int) -> NSDecimalNumber {
        NSDecimalNumber(value: cents).dividing(by: 100)
    }

    /// "$287,60" (es) / "$287.60" (en). AUD amounts use a bare "$" like the design.
    static func aud(_ cents: Int, locale: Locale) -> String {
        formatter(locale: locale, symbol: "$").string(from: decimal(fromCents: cents)) ?? "$0"
    }

    /// Without decimals when the amount is whole: "$900" / "$1.050,50".
    static func audCompact(_ cents: Int, locale: Locale) -> String {
        let decimals = cents % 100 == 0 ? 0 : 2
        return formatter(locale: locale, symbol: "$", decimals: decimals)
            .string(from: decimal(fromCents: cents)) ?? "$0"
    }

    /// Number only, no currency symbol: "287,60".
    static func plainAmount(_ cents: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: decimal(fromCents: cents)) ?? "0"
    }

    /// Original USD amount the user entered: "US$ 7,00" (es) / "US$ 7.00"
    /// (en). Display-only — this is `entryAmountCents`, never summed.
    static func usd(_ cents: Int, locale: Locale) -> String {
        formatter(locale: locale, symbol: "US$ ").string(from: decimal(fromCents: cents)) ?? "US$ 0"
    }

    /// Approximate FX display: "≈ US$ 186,90". Display-only, never persisted.
    static func approxUSD(audCents: Int, rate: Double, locale: Locale) -> String {
        let usd = (Double(audCents) / 100.0) * rate
        let formatter = formatter(locale: locale, symbol: "US$ ")
        let text = formatter.string(from: NSNumber(value: usd)) ?? ""
        return "≈ \(text)"
    }

    /// Approximate AUD equivalent while entering an amount in USD:
    /// "≈ $1.375,00 AUD". Display-only.
    static func approxAUD(_ audCents: Int, locale: Locale) -> String {
        "≈ \(aud(audCents, locale: locale)) AUD"
    }
}
