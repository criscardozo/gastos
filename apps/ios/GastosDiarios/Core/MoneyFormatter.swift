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

    /// The amount the bank actually charged in USD: "US$ 7,00" (es) /
    /// "US$ 7.00" (en). Always exact — the app never converts anything, it only
    /// ever shows a figure that came from the bank.
    static func usd(_ cents: Int, locale: Locale) -> String {
        formatter(locale: locale, symbol: "US$ ").string(from: decimal(fromCents: cents)) ?? "US$ 0"
    }

    /// "$ 241.402,75" — Argentine pesos, always in es-AR whatever the app's
    /// language. A peso figure written with English separators reads as a
    /// different number to the person comparing it against a BBVA statement,
    /// and this figure exists only to be compared against one.
    static func ars(_ cents: Int, locale _: Locale) -> String {
        formatter(locale: Locale(identifier: "es_AR"), symbol: "$ ")
            .string(from: decimal(fromCents: cents)) ?? "$ 0"
    }
}
