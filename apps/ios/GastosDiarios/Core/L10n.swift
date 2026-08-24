import Foundation

/// String lookup with an in-app language override (each household member can
/// use a different language, independent of the system one).
/// Strings live in Localizable.xcstrings (es = development language).
struct L10n {
    /// Resolved language code: "es" or "en".
    let language: String

    var locale: Locale {
        Locale(identifier: language == "en" ? "en_AU" : "es_AR")
    }

    /// The bundle these strings were compiled into.
    ///
    /// NOT `Bundle.main`: in a unit-test bundle that is the test runner, which
    /// carries no .lproj, so every lookup silently returned the key itself
    /// ("days.one" instead of "1 día"). Resolving through a type in this module
    /// gives the app bundle in the app and the test bundle in tests, which is
    /// what lets the tests run without depending on the app target at all.
    private static let resourceBundle = Bundle(for: L10nBundleToken.self)

    private var bundle: Bundle {
        guard let path = Self.resourceBundle.path(forResource: language, ofType: "lproj"),
              let bundle = Bundle(path: path)
        else { return Self.resourceBundle }
        return bundle
    }

    /// Localized string for `key`.
    func t(_ key: String) -> String {
        bundle.localizedString(forKey: key, value: key, table: nil)
    }

    /// Localized format string for `key` with arguments.
    func t(_ key: String, _ args: CVarArg...) -> String {
        String(format: t(key), locale: locale, arguments: args)
    }

    /// Spanish by default; English only by explicit user choice (the language
    /// setting stored on users/{uid}) — never from the device language.
    static func resolve(userLanguage: String?) -> L10n {
        if let userLanguage, ["es", "en"].contains(userLanguage) {
            return L10n(language: userLanguage)
        }
        return L10n(language: "es")
    }

    // MARK: Category names
    // Display rule: category.key ? t(category.key) : category.name.
    func categoryName(_ category: Category) -> String {
        if let key = category.key {
            return t("category.\(key)")
        }
        return category.name ?? ""
    }

    // MARK: Date display helpers

    private func dateFormatter(_ format: String, timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(format)
        return formatter
    }

    private func instant(of date: CalendarDate, in timeZone: TimeZone) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = date.raw.split(separator: "-")
        return calendar.date(from: DateComponents(
            year: Int(parts[0]), month: Int(parts[1]), day: Int(parts[2]), hour: 12
        )) ?? Date()
    }

    /// "sáb 11" — quick entry date pill.
    func shortWeekday(_ date: CalendarDate, timeZone: TimeZone) -> String {
        dateFormatter("EEE d", timeZone: timeZone)
            .string(from: instant(of: date, in: timeZone))
    }

    /// "sábado 11 jul" — history day headers.
    func dayHeader(_ date: CalendarDate, timeZone: TimeZone) -> String {
        dateFormatter("EEEE d MMM", timeZone: timeZone)
            .string(from: instant(of: date, in: timeZone))
    }

    /// "sábado" — bare weekday name.
    func weekdayName(_ date: CalendarDate, timeZone: TimeZone) -> String {
        dateFormatter("EEEE", timeZone: timeZone)
            .string(from: instant(of: date, in: timeZone))
    }

    /// "9 jul" — bare day + short month.
    func dayMonth(_ date: CalendarDate, timeZone: TimeZone) -> String {
        dateFormatter("d MMM", timeZone: timeZone)
            .string(from: instant(of: date, in: timeZone))
    }

    /// "28 jul, 13:48" — an absolute instant in the DEVICE timezone (used for
    /// the signing expiry, which is a wall-clock moment, not a ledger date).
    func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("d MMM HH:mm")
        return formatter.string(from: date)
    }

    /// "1 – 14 de julio" (same month) / "29 jun – 5 jul" — period navigator.
    func periodRange(start: CalendarDate, end: CalendarDate, timeZone: TimeZone, long: Bool = true) -> String {
        let startInstant = instant(of: start, in: timeZone)
        let endInstant = instant(of: end, in: timeZone)
        let sameMonth = String(start.raw.prefix(7)) == String(end.raw.prefix(7))
        let dayOnly = dateFormatter("d", timeZone: timeZone)
        if sameMonth {
            let month = dateFormatter(long ? "MMMM" : "MMM", timeZone: timeZone)
                .string(from: endInstant)
            let of = language == "es" && long ? "de " : ""
            return "\(dayOnly.string(from: startInstant)) – \(dayOnly.string(from: endInstant)) \(of)\(month)"
        }
        let short = dateFormatter("d MMM", timeZone: timeZone)
        return "\(short.string(from: startInstant)) – \(short.string(from: endInstant))"
    }

    /// "1 – 14 jul" — compact range for settings/history.
    func periodRangeCompact(start: CalendarDate, end: CalendarDate, timeZone: TimeZone) -> String {
        periodRange(start: start, end: end, timeZone: timeZone, long: false)
    }

    /// "miércoles 1 de julio" — onboarding start row.
    func longDate(_ date: CalendarDate, timeZone: TimeZone) -> String {
        dateFormatter("EEEE d MMMM", timeZone: timeZone)
            .string(from: instant(of: date, in: timeZone))
    }

    /// "4 días" / "1 día" — days-left values.
    func daysCount(_ days: Int) -> String {
        days == 1 ? t("days.one") : t("days.other", days)
    }

    // Counted labels need a key per grammatical number: the catalog holds plain
    // `%d` formats and `t(_:_:)` resolves them with String(format:), which has
    // no notion of plurals — "%d descartados" would render "1 descartados".

    /// "1 descartado" / "3 descartados" — the recoverable-dismissals disclosure.
    func dismissedChargesCount(_ count: Int) -> String {
        count == 1 ? t("bank.dismissedOne") : t("bank.dismissedOther", count)
    }

    /// "1 cargo del banco" / "2 cargos del banco" — the Historial chip.
    func bankChargesCount(_ count: Int) -> String {
        count == 1 ? t("history.bankChargesOne") : t("history.bankChargesOther", count)
    }
}

/// Anchor for `Bundle(for:)`. A struct has no class to hand it, and hardcoding
/// an identifier would break the moment the bundle id changes.
private final class L10nBundleToken {}
