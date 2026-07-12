import Foundation
import UserNotifications

/// Daily "log your expenses" reminder — a plain local notification, no
/// backend. Enabled state and time are a PER-DEVICE preference stored in
/// UserDefaults (never Firestore: each member picks their own reminder).
enum ReminderService {

    private static let enabledKey = "reminder.enabled"
    private static let hourKey = "reminder.hour"
    private static let minuteKey = "reminder.minute"
    private static let requestId = "dailyReminder"

    static var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: enabledKey)
    }

    /// Chosen reminder time; 21:00 by default.
    static var time: (hour: Int, minute: Int) {
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: hourKey) != nil else { return (21, 0) }
        return (defaults.integer(forKey: hourKey), defaults.integer(forKey: minuteKey))
    }

    /// Enables the reminder, requesting notification authorization first.
    /// Returns false (leaving the preference off) when the user denies.
    static func enable(l10n: L10n) async -> Bool {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        guard granted else {
            UserDefaults.standard.set(false, forKey: enabledKey)
            return false
        }
        UserDefaults.standard.set(true, forKey: enabledKey)
        await schedule(l10n: l10n)
        return true
    }

    static func disable() {
        UserDefaults.standard.set(false, forKey: enabledKey)
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [requestId])
    }

    /// Persists a new time and re-schedules if enabled.
    static func setTime(hour: Int, minute: Int, l10n: L10n) async {
        UserDefaults.standard.set(hour, forKey: hourKey)
        UserDefaults.standard.set(minute, forKey: minuteKey)
        if isEnabled {
            await schedule(l10n: l10n)
        }
    }

    /// Whether notifications are denied at the system level (the toggle
    /// then shows a footnote pointing to system settings).
    static func isDenied() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .denied
    }

    /// (Re)schedules the repeating daily notification, replacing any
    /// previous one (same request identifier).
    private static func schedule(l10n: L10n) async {
        let content = UNMutableNotificationContent()
        content.title = "Gastos Diarios"
        content.body = l10n.t("reminder.body")
        content.sound = .default

        var components = DateComponents()
        let time = self.time
        components.hour = time.hour
        components.minute = time.minute
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)

        let request = UNNotificationRequest(identifier: requestId, content: content, trigger: trigger)
        try? await UNUserNotificationCenter.current().add(request)
        // Tapping the notification just opens the app — quick entry is the
        // default tab, so no deep-link handling is needed.
    }
}
