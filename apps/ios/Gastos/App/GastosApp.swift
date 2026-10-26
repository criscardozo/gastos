import SwiftUI
import FirebaseCore
import UserNotifications

@main
struct GastosApp: App {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        FirebaseApp.configure()
        // Must run before any Firestore/Auth usage.
        FirestoreService.configureEmulatorsIfRequested()
        AuthService.configureGoogleSignIn()
        let model = AppModel()
        _model = State(initialValue: model)
        // Both before launch finishes: iOS refuses a background-task handler
        // registered later, and a notification tapped from a cold start is
        // delivered to whichever delegate is set by then.
        BankAlerts.register(firestore: model.firestore)
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onOpenURL { url in
                    if url.scheme == "gastos" {
                        // gastos://nuevo | ://historial | ://cargos —
                        // deep links usable from a plain "Open URL" Shortcut.
                        switch url.host {
                        case "cargos": AppModel.requestBankCharges()
                        case "historial": AppModel.requestHistory()
                        default: AppModel.requestQuickEntry()
                        }
                        return
                    }
                    _ = AuthService.handle(url: url)
                }
                .onAppear {
                    model.start()
                    BankAlerts.runForEmulatorIfRequested(firestore: model.firestore)
                    LogPaymentIntent.runForEmulatorIfRequested()
                    LogBankChargeIntent.runForEmulatorIfRequested()
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background {
                        // What was on screen is not news; ask iOS for the
                        // next background look.
                        model.markBankAlertsSeen()
                        BankAlerts.schedule()
                    }
                    guard phase == .active else { return }
                    // iOS 18 Control (widget process) left a launch request.
                    if QuickEntryBridge.consumePending() {
                        AppModel.requestQuickEntry()
                    }
                    model.dayMayHaveChanged()
                    // Past-period aggregations aren't live — refresh on foreground.
                    model.refreshPastTotals()
                    model.publishWidgetSnapshot()
                }
                // Midnight with the app open: the device's calendar day, which
                // for this household is Sydney's too. The check itself reads
                // the household's timezone, so a false alarm costs nothing.
                .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
                    model.dayMayHaveChanged()
                }
        }
    }
}
