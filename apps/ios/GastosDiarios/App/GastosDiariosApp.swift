import SwiftUI
import FirebaseCore

@main
struct GastosDiariosApp: App {
    @State private var model: AppModel

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
                    _ = AuthService.handle(url: url)
                }
                .onAppear { model.start() }
        }
    }
}
