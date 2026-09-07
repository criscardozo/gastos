import Foundation
import WatchConnectivity

/// Watch side of the relay. Sends the typed expense to the phone via
/// `transferUserInfo` (queues and delivers even when the phone app is
/// backgrounded/asleep — offline-on-the-watch) and receives the budget
/// snapshot the phone pushes via `updateApplicationContext`.
final class WatchConnectivityModel: NSObject, ObservableObject {

    @Published var budget: WatchBudget?

    private var session: WCSession { WCSession.default }

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        session.delegate = self
        session.activate()
    }

    /// Queues an expense for delivery to the phone. `clientId` gives the phone
    /// idempotency against a redelivered transfer.
    func sendExpense(amountCents: Int, categoryId: String, dateYMD: String) {
        guard WCSession.isSupported() else { return }
        session.transferUserInfo([
            "amountCents": amountCents,
            "categoryId": categoryId,
            "dateYMD": dateYMD,
            "clientId": UUID().uuidString,
        ])
    }

    private func apply(_ context: [String: Any]) {
        guard let remaining = context["remainingCents"] as? Int else { return }
        let budget = WatchBudget(
            remainingCents: remaining,
            budgetCents: context["budgetCents"] as? Int ?? 0,
            state: context["state"] as? String ?? "comfortable",
            currency: context["currency"] as? String ?? "AUD"
        )
        DispatchQueue.main.async { self.budget = budget }
    }
}

extension WatchConnectivityModel: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        apply(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        apply(applicationContext)
    }
}
