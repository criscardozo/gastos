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

    private var bundle: Bundle {
        guard let path = Bundle.main.path(forResource: language, ofType: "lproj"),
              let bundle = Bundle(path: path)
        else { return .main }
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

    /// System/browser-independent resolution: explicit user choice, else the
    /// device's preferred language, defaulting to Spanish.
    static func resolve(userLanguage: String?) -> L10n {
        if let userLanguage, ["es", "en"].contains(userLanguage) {
            return L10n(language: userLanguage)
        }
        let preferred = Locale.preferredLanguages.first ?? "es"
        return L10n(language: preferred.hasPrefix("en") ? "en" : "es")
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
}
