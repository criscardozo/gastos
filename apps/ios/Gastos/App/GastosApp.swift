import SwiftUI
import FirebaseCore

@main
struct GastosApp: App {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        FirebaseApp.configure()
        // Must run before any Firestore/Auth usage.
        FirestoreService.configureEmulatorsIfRequested()
        AuthService.configureGoogleSignIn()
        _model = State(initialValue: AppModel())
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
                .onAppear { model.start() }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    // iOS 18 Control (widget process) left a launch request.
                    if QuickEntryBridge.consumePending() {
                        AppModel.requestQuickEntry()
                    }
                    // Past-period aggregations aren't live — refresh on foreground.
                    model.refreshPastTotals()
                    model.publishWidgetSnapshot()
                }
        }
    }
}
