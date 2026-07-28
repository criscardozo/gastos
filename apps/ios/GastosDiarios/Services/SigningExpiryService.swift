import Foundation
import UserNotifications

/// When this build's code signature stops working.
///
/// Distribution is a free-account sideload, so the provisioning profile lives
/// for 7 days and the app simply stops launching afterwards. The expiry date is
/// read from the profile embedded in the bundle rather than from a stored
/// "installed on" date: re-signing does NOT wipe the app container, so a stored
/// date would keep reporting the very first install forever, while the embedded
/// profile is replaced on every signing.
///
/// Absent in Simulator and App Store builds (they carry no profile), in which
/// case everything here reports nil and the UI hides itself.
enum SigningExpiryService {

    /// Expiry of the provisioning profile embedded in the running bundle.
    /// Computed once — the bundle cannot change while the app is running.
    static let expiryDate: Date? = readEmbeddedProfileExpiry()

    /// Whole days until the signature expires (0 = expires today, negative =
    /// already expired). nil when there is no profile to read.
    static func daysRemaining(now: Date = Date()) -> Int? {
        guard let expiryDate else { return nil }
        return daysRemaining(expiry: expiryDate, now: now)
    }

    /// Whole calendar days between two instants — the testable core.
    static func daysRemaining(expiry: Date, now: Date) -> Int {
        let calendar = Calendar.current
        return calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: expiry)
        ).day ?? 0
    }

    /// True inside the warning window the user asked for: two days out or less.
    static func isExpiringSoon(now: Date = Date()) -> Bool {
        guard let days = daysRemaining(now: now) else { return false }
        return days <= 2
    }

    // MARK: Reading the profile

    /// `embedded.mobileprovision` is a CMS (PKCS#7) container wrapping a plist.
    /// The signature is Apple's and we are not validating it — we only need the
    /// payload — so the plist is sliced out by its XML delimiters instead of
    /// pulling in a crypto dependency.
    private static func readEmbeddedProfileExpiry() -> Date? {
        guard let url = Bundle.main.url(
            forResource: "embedded",
            withExtension: "mobileprovision"
        ), let data = try? Data(contentsOf: url) else { return nil }
        return expiry(fromProfile: data)
    }

    /// Slices the plist out of a `.mobileprovision` blob and reads its expiry.
    /// Internal so tests can exercise it without a signed bundle.
    static func expiry(fromProfile data: Data) -> Date? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(
                of: Data("</plist>".utf8),
                options: [],
                in: start.lowerBound..<data.endIndex
              )
        else { return nil }

        let plistData = data[start.lowerBound..<end.upperBound]
        let plist = try? PropertyListSerialization.propertyList(
            from: plistData,
            options: [],
            format: nil
        )
        return (plist as? [String: Any])?["ExpirationDate"] as? Date
    }

    // MARK: Warning notifications

    private static let requestIds = ["signingExpiry.t2", "signingExpiry.t1"]

    /// Schedules "your build expires" reminders two days and one day out, both
    /// at 10:00 local time.
    ///
    /// Deliberately does NOT ask for notification permission: being nagged for
    /// it on launch would be worse than the warning is worth. When permission
    /// hasn't been granted the home banner and the Settings row still tell the
    /// story. Re-scheduled on every launch (identifiers are stable, so this
    /// replaces rather than duplicates) because the date moves on each signing.
    static func scheduleWarnings(l10n: L10n) async {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: requestIds)

        guard let expiryDate else { return }
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
        else { return }

        let calendar = Calendar.current
        for (index, daysBefore) in [2, 1].enumerated() {
            guard let day = calendar.date(byAdding: .day, value: -daysBefore, to: expiryDate),
                  let fireDate = calendar.date(
                    bySettingHour: 10, minute: 0, second: 0, of: day
                  )
            else { continue }
            // A warning in the past would never fire; skip it rather than
            // leaving a dead request behind.
            guard fireDate > Date() else { continue }

            let content = UNMutableNotificationContent()
            content.title = l10n.t("signing.notification.title")
            content.body = l10n.t(
                daysBefore == 1 ? "signing.notification.body.one" : "signing.notification.body.two"
            )
            content.sound = .default

            let components = calendar.dateComponents(
                [.year, .month, .day, .hour, .minute], from: fireDate
            )
            let request = UNNotificationRequest(
                identifier: requestIds[index],
                content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            )
            try? await center.add(request)
        }
    }
}
