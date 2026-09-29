import Foundation

/// The date an expense typed on the watch is filed under.
///
/// The watch used to send only a "YYYY-MM-DD" it formatted in ITS OWN
/// timezone, and the phone filed that string as it came — the one place in
/// either app where an expense date was the device's rather than the
/// household's. The watch cannot know the household's timezone (it never
/// touches Firestore), so it now sends the instant the expense was typed and
/// the phone, which does know, turns that into the day. The instant also
/// keeps a transfer delivered hours later — the watch queues them — on the day
/// it was typed rather than the day it arrived.
///
/// The string is still read when the instant is missing: the payload of a
/// watch app older than this phone app.
enum WatchExpenseDate {
    static func resolve(
        enteredAt: Double?, dateYMD: String?, householdTimeZone: TimeZone
    ) -> CalendarDate? {
        if let enteredAt {
            return PeriodLogic.todayInTimezone(
                Date(timeIntervalSince1970: enteredAt), householdTimeZone
            )
        }
        return dateYMD.flatMap(CalendarDate.init)
    }
}
