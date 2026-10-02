import Foundation

/// Formats integer cents into display strings. Money is NEVER a float in the
/// data layer — Doubles only appear at the last formatting step.
///
/// ONE number format for the whole app, in both languages: a point for the
/// decimals and nothing grouping the thousands — "$1050.00", "US$ 186.90",
/// "$ 241402.75". Cristian's call on 2026-10-02, the same as the web's
/// lib/money.ts. Until then Spanish followed es_AR ("$ 1.050,00") and English
/// en_AU ("$1,050.00"). The `locale` parameters are kept and ignored, so no
/// call site had to change; dates still follow the language.
enum MoneyFormatter {
    /// What the amount keypad writes for the decimals.
    static let decimalSeparator = "."

    /// The format's locale: en_AU already writes a point; grouping is off.
    private static let numberLocale = Locale(identifier: "en_AU")

    private static func formatter(locale _: Locale, symbol: String, decimals: Int = 2) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = numberLocale
        formatter.usesGroupingSeparator = false
        formatter.currencySymbol = symbol
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter
    }

    private static func decimal(fromCents cents: Int) -> NSDecimalNumber {
        NSDecimalNumber(value: cents).dividing(by: 100)
    }

    /// "$287.60". AUD amounts use a bare "$" like the design.
    static func aud(_ cents: Int, locale: Locale) -> String {
        formatter(locale: locale, symbol: "$").string(from: decimal(fromCents: cents)) ?? "$0"
    }

    /// Without decimals when the amount is whole: "$900" / "$1050.50".
    static func audCompact(_ cents: Int, locale: Locale) -> String {
        let decimals = cents % 100 == 0 ? 0 : 2
        return formatter(locale: locale, symbol: "$", decimals: decimals)
            .string(from: decimal(fromCents: cents)) ?? "$0"
    }

    /// Number only, no currency symbol: "287.60".
    static func plainAmount(_ cents: Int, locale _: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = numberLocale
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: decimal(fromCents: cents)) ?? "0"
    }

    /// A rate with `digits` places — 3 for a bank rate beside a match, 2 for
    /// pesos per dollar. `minDigits` lets the peso rate drop the places it
    /// does not need ("1500", "1500.5"). The web's formatRate.
    static func rate(_ rate: Double, digits: Int = 3, minDigits: Int? = nil) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = numberLocale
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = minDigits ?? digits
        formatter.maximumFractionDigits = digits
        return formatter.string(from: NSNumber(value: rate)) ?? "—"
    }

    /// The amount the bank actually charged in USD: "US$ 7.00". Always exact — the app never converts anything, it only
    /// ever shows a figure that came from the bank.
    static func usd(_ cents: Int, locale: Locale) -> String {
        formatter(locale: locale, symbol: "US$ ").string(from: decimal(fromCents: cents)) ?? "US$ 0"
    }

    /// "$ 241402.75" — Argentine pesos. Kept in es_AR ("$ 241.402,75") until
    /// 2026-10-02, to read like a BBVA statement; they follow the one format
    /// now like everything else.
    static func ars(_ cents: Int, locale _: Locale) -> String {
        formatter(locale: numberLocale, symbol: "$ ")
            .string(from: decimal(fromCents: cents)) ?? "$ 0"
    }
}
