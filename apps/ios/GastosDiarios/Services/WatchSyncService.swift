import Foundation
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif

/// Phone side of the Watch relay. The watchOS app cannot authenticate with
/// Google (no browser) and therefore never touches Firestore itself — it sends
/// expense payloads over WatchConnectivity and this service, running in the
/// already-authenticated phone app, performs the actual Firestore write.
///
/// It also pushes the current budget snapshot to the watch via
/// `updateApplicationContext` (app groups do NOT cross the phone/watch device
/// boundary, so the widget's app-group snapshot is not readable there).
final class WatchSyncService: NSObject {

    static let shared = WatchSyncService()

    /// Keys shared verbatim with the watch target's payload.
    enum Key {
        static let amountCents = "amountCents"
        static let categoryId = "categoryId"
        static let dateYMD = "dateYMD"
        static let clientId = "clientId"
        // Budget context (phone → watch).
        static let remainingCents = "remainingCents"
        static let budgetCents = "budgetCents"
        static let state = "state"
        static let currency = "currency"
        static let usdRate = "usdRate"
        static let activeCurrency = "activeCurrency"
    }

    #if canImport(WatchConnectivity)
    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }
    private var pendingContext: [String: Any]?
    #endif

    /// Activates the session (idempotent). Called from `AppModel.start()`.
    func start() {
        #if canImport(WatchConnectivity)
        guard let session else { return }
        session.delegate = self
        if session.activationState != .activated {
            session.activate()
        }
        #endif
    }

    /// Pushes the latest budget snapshot to the watch. Cheap and coalescing:
    /// `updateApplicationContext` only keeps the most recent value.
    func updateBudgetContext(
        remainingCents: Int,
        budgetCents: Int,
        state: String,
        currency: String,
        usdRate: Double? = nil,
        activeCurrency: String? = nil
    ) {
        #if canImport(WatchConnectivity)
        var context: [String: Any] = [
            Key.remainingCents: remainingCents,
            Key.budgetCents: budgetCents,
            Key.state: state,
            Key.currency: currency,
        ]
        // Optional bi-currency extras — omitted when there is no daily rate,
        // so the watch simply stays AUD-only.
        if let usdRate { context[Key.usdRate] = usdRate }
        if let activeCurrency { context[Key.activeCurrency] = activeCurrency }
        guard let session, session.activationState == .activated else {
            pendingContext = context
            return
        }
        try? session.updateApplicationContext(context)
        #endif
    }

    #if canImport(WatchConnectivity)
    /// Routes a received expense payload to the authenticated phone app.
    private func handle(userInfo: [String: Any]) {
        guard
            let amountCents = userInfo[Key.amountCents] as? Int,
            let categoryId = userInfo[Key.categoryId] as? String,
            let dateYMD = userInfo[Key.dateYMD] as? String,
            let clientId = userInfo[Key.clientId] as? String,
            amountCents > 0
        else { return }
        Task { @MainActor in
            AppModel.shared?.saveExpenseFromWatch(
                clientId: clientId,
                amountCents: amountCents,
                categoryId: categoryId,
                dateYMD: dateYMD
            )
        }
    }
    #endif
}

#if canImport(WatchConnectivity)
extension WatchSyncService: WCSessionDelegate {

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated, let context = pendingContext else { return }
        pendingContext = nil
        try? session.updateApplicationContext(context)
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // Re-activate so a re-paired / switched watch keeps working.
        session.activate()
    }

    /// Delivered even if the phone app was backgrounded/suspended when the
    /// watch queued the transfer — this is what gives offline-on-the-watch.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        handle(userInfo: userInfo)
    }
}
#endif
