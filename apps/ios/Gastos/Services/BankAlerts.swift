import BackgroundTasks
import FirebaseAuth
import Foundation
import UserNotifications
import os
import UIKit

/// "A charge arrived" and "an expense filed itself", as notifications.
///
/// WHY LOCAL, AND WHY LATE. A real push needs APNs, which a free Apple team
/// cannot use, and a server to send it, which on Firebase means Cloud
/// Functions and the paid plan — both off the table (docs/reglas/costo-cero.md).
/// So the app wakes itself with a background refresh, reads Firestore once,
/// and posts a local notification. iOS decides when that refresh runs: often
/// within the hour, sometimes much later, and never for an app the person
/// swiped away until it is opened again. The setting says so.
///
/// WHAT A RUN DOES, in the order the app does it when it opens:
///   1. files whatever a recurring rule can price — the same plan as
///      `runRecurringRulesIfNeeded`, on the same deterministic ids, so a run
///      racing the other phone or the web writes the same document twice
///      rather than the expense twice;
///   2. announces what this device has not seen: pending charges, and expenses
///      a rule filed (here, on the other phone or on the web). NotificationLedger
///      decides "not seen"; the app being open feeds it too, so nothing you
///      already looked at comes back.
///
/// Per device, like the daily reminder: each member decides for their phone.
///
/// On the main actor because FirestoreService is: the run is a handful of
/// awaited reads, so it never holds the main thread while the network works.
@MainActor
enum BankAlerts {
    nonisolated static let taskId = "dev.cardozo.gastos.refresh"

    nonisolated private static let enabledKey = "bankAlerts.enabled"
    private static let chargesKey = "bankAlerts.seenCharges"
    nonisolated private static let lastRunKey = "bankAlerts.lastRunAt"
    /// How the last run ended, in a word — read from the Simulator with
    /// `simctl spawn … defaults read`, where os.Logger lines do not surface.
    private static let lastOutcomeKey = "bankAlerts.lastOutcome"
    private static let expensesKey = "bankAlerts.seenExpenses"
    /// Enough history to learn the bank's rate from and to catch what a rule
    /// filed while nobody looked, without reading the whole ledger. The rate's
    /// window, so the run reads exactly what the open app learns from.
    private static let lookbackDays = BankMatch.rateWindowDays
    /// Past this many in one run, one summary instead of a stack of banners.
    private static let maxSingle = 3

    nonisolated private static let log = Logger(subsystem: "dev.cardozo.gastos", category: "bankAlerts")

    nonisolated static var isEnabled: Bool { UserDefaults.standard.bool(forKey: enabledKey) }

    /// When a run last read Firestore, or nil if none ever has. Shown under
    /// the setting: the only way to tell "nothing new" from "iOS has not woken
    /// the app" is to say when it last did.
    nonisolated static var lastRunAt: Date? {
        UserDefaults.standard.object(forKey: lastRunKey) as? Date
    }

    private static func finish(_ outcome: String, ok: Bool = true) -> Bool {
        UserDefaults.standard.set(outcome, forKey: lastOutcomeKey)
        return ok
    }

    // MARK: Setting

    /// Turns the alerts on after asking for permission; false (and still off)
    /// when it is refused.
    static func enable() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound])) ?? false
        UserDefaults.standard.set(granted, forKey: enabledKey)
        if granted { schedule() }
        return granted
    }

    /// The background run stays scheduled: with alerts off it still keeps the
    /// widget current, and posts nothing.
    nonisolated static func disable() {
        UserDefaults.standard.set(false, forKey: enabledKey)
    }

    // MARK: Scheduling

    /// Must run before the app finishes launching — iOS refuses a handler
    /// registered later — which is why GastosApp.init calls it.
    static func register(firestore: FirestoreService) {
        // `using: .main`: the handler then runs where FirestoreService lives.
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: .main) { task in
            MainActor.assumeIsolated {
                // The next one is asked for first: a run that times out must
                // not also be the last one.
                schedule()
                let work = Task {
                    let ok = await refresh(firestore: firestore)
                    task.setTaskCompleted(success: ok)
                }
                task.expirationHandler = { work.cancel() }
            }
        }
    }

    /// Asks iOS for the next run, no sooner than 15 minutes from now — the
    /// same cadence as the ingestion that files the charges. iOS treats it as
    /// "not before", never as "at".
    /// Scheduled whether or not the alerts are on: with them off a run still
    /// refreshes the widget (and does nothing else), which otherwise only the
    /// open app ever did.
    nonisolated static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: taskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        Task {
            do {
                try await BGTaskScheduler.shared.submitTaskRequest(request)
            } catch {
                // The Simulator refuses every submit; a device refuses when
                // Background App Refresh is off for the app.
                log.notice("refresh not scheduled: \(String(describing: error), privacy: .public)")
            }
        }
    }

    /// Emulator-only: one run 20 seconds after launch (`-gd-bank-alerts-run`),
    /// long enough to send the app to the background first. The Simulator
    /// never fires a background refresh on its own, and this is the only way
    /// to see what one posts. A no-op against production.
    static func runForEmulatorIfRequested(firestore: FirestoreService) {
        guard FirestoreService.emulatorsRequested,
              CommandLine.arguments.contains("-gd-bank-alerts-run")
        else { return }
        // Held awake like a real refresh would be: a backgrounded app is
        // suspended within seconds, and the run would sit until it reopened.
        let hold = UIApplication.shared.beginBackgroundTask()
        UserDefaults.standard.set("debug run requested", forKey: lastOutcomeKey)
        Task {
            try? await Task.sleep(for: .seconds(20))
            await refresh(firestore: firestore)
            UIApplication.shared.endBackgroundTask(hold)
        }
    }

    // MARK: What the open app has shown

    /// Records ids as seen without announcing them — called as the app goes to
    /// the background with whatever it had on screen. Never starts the
    /// baseline (see NotificationLedger): the first run does, silently.
    static func markSeen(chargeIds: [String], expenseIds: [String]) {
        let defaults = UserDefaults.standard
        for (key, ids) in [(chargesKey, chargeIds), (expensesKey, expenseIds)] {
            if let seen = NotificationLedger.marking(ids, seen: defaults.stringArray(forKey: key)) {
                defaults.set(seen, forKey: key)
            }
        }
    }

    // MARK: The run

    /// One pass. Returns false only when Firestore could not be read, which
    /// tells iOS the run failed rather than that there was nothing to say.
    @discardableResult
    static func refresh(firestore: FirestoreService) async -> Bool {
        guard let uid = Auth.auth().currentUser?.uid else { return finish("signed-out") }
        do {
            guard let profile = try await firestore.fetchUserProfile(uid: uid),
                  let householdId = profile.householdId,
                  let household = try await firestore.fetchHousehold(id: householdId)
            else { return finish("no-household") }
            let l10n = L10n.resolve(userLanguage: profile.language)

            let today = PeriodLogic.todayInTimezone(Date(), household.timeZone)
            let from = PeriodLogic.addDays(today, -lookbackDays)
            guard isEnabled else {
                // Alerts off: the widget, and nothing else — no filing, no
                // banners.
                let expenses = try await firestore.fetchExpenses(
                    householdId: householdId, startDate: from.raw, endDate: today.raw,
                    source: .server
                )
                let widget = await publishWidget(
                    firestore: firestore, householdId: householdId, household: household,
                    today: today, from: from, expenses: expenses
                )
                return finish("widget only: \(widget.map(String.init) ?? "not published")")
            }
            let charges = try await firestore.fetchBankCharges(householdId: householdId)
            let rules = try await firestore.fetchRecurringRules(householdId: householdId)
            let expenses = try await firestore.fetchExpenses(
                householdId: householdId, startDate: from.raw, endDate: today.raw,
                source: .server
            )
            try Task.checkCancellation()
            UserDefaults.standard.set(Date(), forKey: lastRunKey)

            let pending = BankChargeInbox.partition(charges, now: Date()).pending

            // 1. File what the rules can price, exactly as the open app would.
            let liveRules = rules.filter { !(household.categories[$0.categoryId]?.isArchived ?? false) }
            let plan = RecurringRules.planRun(
                pending: pending.filter { household.belongsToExpenses(cardLast4: $0.cardLast4) },
                rules: liveRules,
                learnedRate: BankMatch.learnRate(expenses, asOf: today),
                seen: [], filed: []
            )
            var filedNow: [Filed] = []
            // One at a time, like fileOneRecurring: a burst of concurrent
            // batches is how a free-tier quota goes.
            for claim in plan.file {
                guard let amount = claim.amountAudCents else { continue }
                do {
                    try await firestore.fileRecurringExpense(
                        householdId: householdId, uid: uid, charge: claim.charge,
                        rule: claim.rule, amountAudCents: amount, estimated: claim.estimated
                    )
                    filedNow.append(Filed(
                        id: FirestoreService.autoExpenseId(chargeId: claim.charge.id),
                        note: claim.rule.note, amountCents: amount
                    ))
                } catch {
                    // The other phone or the web filed it first: the rules
                    // refuse the second create. Its expense is announced below
                    // like any other.
                    log.notice("not filed \(claim.charge.id, privacy: .public): \(String(describing: error), privacy: .public)")
                }
            }

            // 2. Announce what this device has not seen.
            let filedChargeIds = Set(filedNow.compactMap { FirestoreService.chargeId(fromAutoExpense: $0.id) })
            // A charge filed from the BBVA notification is not news: the bank's
            // own app just showed it, and announcing it again is a second
            // banner for one purchase.
            let newCharges = pending.filter {
                !filedChargeIds.contains($0.id) && $0.source != "notification"
            }
            var automatic = filedNow
            for expense in expenses where expense.isFiledByRule {
                guard let id = expense.id, !automatic.contains(where: { $0.id == id }) else { continue }
                automatic.append(Filed(id: id, note: expense.note, amountCents: expense.amountCents))
            }

            // 3. The widget. Only the open app used to publish it, so after a
            // period ended it kept showing the old remaining figure, and the
            // other member's spending never reached it until this phone opened
            // the app. One more read — the current period — and the same sum
            // the app shows, over the expenses already fetched above.
            await publishWidget(
                firestore: firestore, householdId: householdId, household: household,
                today: today, from: from, expenses: expenses
            )

            let defaults = UserDefaults.standard
            let chargeRun = NotificationLedger.fresh(
                newCharges.map(\.id), seen: defaults.stringArray(forKey: chargesKey)
            )
            let expenseRun = NotificationLedger.fresh(
                automatic.map(\.id), seen: defaults.stringArray(forKey: expensesKey)
            )
            defaults.set(chargeRun.seen, forKey: chargesKey)
            defaults.set(expenseRun.seen, forKey: expensesKey)

            let announceCharges = chargeRun.announce.compactMap { id in newCharges.first { $0.id == id } }
            let announceFiled = expenseRun.announce.compactMap { id in automatic.first { $0.id == id } }
            log.notice("run: \(pending.count) pending, filed \(filedNow.count), announcing \(announceCharges.count) charges and \(announceFiled.count) filed")
            await post(charges: announceCharges, household: household, l10n: l10n)
            await post(filed: announceFiled, l10n: l10n)
            let delivered = await UNUserNotificationCenter.current().deliveredNotifications().count
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            return finish("ok: \(pending.count) pending, filed \(filedNow.count), announced \(announceCharges.count)+\(announceFiled.count), delivered \(delivered), auth \(settings.authorizationStatus.rawValue) alert \(settings.alertSetting.rawValue)")
        } catch {
            log.error("refresh failed: \(String(describing: error), privacy: .public)")
            return finish("failed: \(error.localizedDescription)", ok: false)
        }
    }

    private struct Filed {
        let id: String
        let note: String
        let amountCents: Int
    }

    /// The remaining cents it published, or nil when it published nothing.
    @discardableResult
    private static func publishWidget(
        firestore: FirestoreService, householdId: String, household: Household,
        today: CalendarDate, from: CalendarDate, expenses: [Expense]
    ) async -> Int? {
        guard let period = try? await firestore.fetchCurrentPeriod(householdId: householdId, today: today),
              let start = CalendarDate(period.startDate),
              // The expenses above reach back `lookbackDays`; a period starting
              // earlier would be summed short, so it is left to the open app.
              start.raw >= from.raw
        else { return nil }
        let spent = expenses
            .filter { $0.date >= period.startDate && $0.date <= period.endDate }
            .filter { household.categories[$0.categoryId]?.isBudgeted ?? true }
            .reduce(0) { $0 + $1.amountCents }
        WidgetBridge.publish(WidgetBridge.Snapshot(
            remainingCents: period.amountCents - spent,
            budgetCents: period.amountCents,
            state: PeriodLogic.budgetState(spentCents: spent, budgetCents: period.amountCents).rawValue,
            periodEndDate: period.endDate,
            currency: household.currency,
            timezone: household.timezone,
            updatedAtEpoch: Int(Date().timeIntervalSince1970)
        ))
        return period.amountCents - spent
    }

    // MARK: Notifications

    private static func post(charges: [BankCharge], household: Household, l10n: L10n) async {
        guard !charges.isEmpty else { return }
        // A credit-card charge belongs to Tarjetas, the rest to Historial —
        // the same routing the two inboxes use.
        func route(_ charge: BankCharge) -> String {
            household.routing(forCardLast4: charge.cardLast4) == .credit ? "tarjetas" : "cargos"
        }
        func line(_ charge: BankCharge) -> String {
            let usd = MoneyFormatter.usd(charge.usdCents, locale: l10n.locale)
            return charge.merchant.isEmpty ? usd : "\(MerchantName.display(charge.merchant)) · \(usd)"
        }
        if charges.count <= maxSingle {
            for charge in charges {
                await add(
                    id: "charge-\(charge.id)", title: l10n.t("alerts.charge.title"),
                    body: line(charge), route: route(charge)
                )
            }
        } else {
            let routes = Set(charges.map(route))
            await add(
                id: "charges-\(charges[0].id)",
                title: l10n.t("alerts.charges.title", charges.count),
                body: charges.prefix(maxSingle).map(line).joined(separator: "\n") + "\n…",
                route: routes.count == 1 ? routes.first! : "cargos"
            )
        }
    }

    private static func post(filed: [Filed], l10n: L10n) async {
        guard !filed.isEmpty else { return }
        func line(_ item: Filed) -> String {
            "\(item.note) · \(MoneyFormatter.aud(item.amountCents, locale: l10n.locale))"
        }
        if filed.count <= maxSingle {
            for item in filed {
                await add(
                    id: "filed-\(item.id)", title: l10n.t("alerts.filed.title"),
                    body: line(item), route: "historial"
                )
            }
        } else {
            await add(
                id: "filed-\(filed[0].id)",
                title: l10n.t("alerts.filed.many", filed.count),
                body: filed.prefix(maxSingle).map(line).joined(separator: "\n") + "\n…",
                route: "historial"
            )
        }
    }

    private static func add(id: String, title: String, body: String, route: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["route": route]
        // Grouped on the lock screen apart from the daily reminder.
        content.threadIdentifier = "bank"
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            log.error("notification \(id, privacy: .public) not added: \(String(describing: error), privacy: .public)")
        }
    }
}

/// Where a tapped notification takes you, and what happens to one that
/// arrives while the app is open.
///
/// On the main actor, with the completion-handler forms rather than the
/// `async` ones. The `async` forms ran off the main thread (this type was
/// nonisolated), so the system's completion handler ran there too — and on a
/// tap UIKit answers it by taking the app's snapshot, which asserts it is on
/// the main thread. Tapping any alert killed the app (SIGABRT in
/// `_performBlockAfterCATransactionCommitSynchronizes`). The system calls a
/// notification delegate on the main thread, so this is where it already was.
@MainActor
final class NotificationRouter: NSObject, @preconcurrency UNUserNotificationCenterDelegate {
    static let shared = NotificationRouter()

    /// Not shown while the app is open: the charge or the expense is already
    /// on screen, in the list it would have pointed to. Same as before there
    /// was a delegate at all, which is also what the daily reminder relied on.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        switch response.notification.request.content.userInfo["route"] as? String {
        case "cargos": AppModel.requestBankCharges()
        case "tarjetas": AppModel.requestCards()
        case "historial": AppModel.requestHistory()
        default: break
        }
        completionHandler()
    }
}
