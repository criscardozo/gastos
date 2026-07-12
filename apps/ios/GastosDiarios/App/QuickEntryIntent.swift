import AppIntents
import Foundation

// Back Tap cannot be intercepted by apps directly — it triggers a Shortcut,
// and this App Intent is what that Shortcut runs. Wiring (documented in
// apps/ios/README.md): Settings → Accessibility → Touch → Back Tap →
// Double Tap → "Registrar gasto".
//
// This file is compiled into BOTH the app target and the widget extension
// target (see project.yml) so the iOS 18 Control Center button can launch
// the same intent. The WIDGET_EXTENSION compilation condition selects the
// per-process behavior.

/// App-group handoff for the quick-entry launch request. The widget
/// extension process cannot reach AppModel, so it leaves a flag that the
/// app consumes when it becomes active.
enum QuickEntryBridge {
    static let appGroupId = "group.dev.cardozo.gastosdiarios"
    private static let pendingKey = "pendingQuickEntry"

    static func setPending() {
        UserDefaults(suiteName: appGroupId)?.set(true, forKey: pendingKey)
    }

    /// True (clearing the flag) when a quick-entry launch is pending.
    static func consumePending() -> Bool {
        guard let defaults = UserDefaults(suiteName: appGroupId),
              defaults.bool(forKey: pendingKey)
        else { return false }
        defaults.removeObject(forKey: pendingKey)
        return true
    }
}

/// Opens the app straight on the quick-entry screen.
struct QuickEntryIntent: AppIntent {
    static let title: LocalizedStringResource = "Registrar gasto"
    static let description = IntentDescription("Abre la carga rápida de gastos.")
    /// Foreground intent: runs with the app open.
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        #if WIDGET_EXTENSION
        // Runs in the widget process (iOS 18 Control): openAppWhenRun brings
        // the app forward; this flag routes it to the quick-entry tab.
        QuickEntryBridge.setPending()
        #else
        AppModel.requestQuickEntry()
        #endif
        return .result()
    }
}

#if !WIDGET_EXTENSION
/// Exposes the intent in the Shortcuts app (and to Siri) with zero setup.
/// App target only — an app has exactly one AppShortcutsProvider.
struct GastosDiariosShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: QuickEntryIntent(),
            phrases: [
                "Registrar gasto en \(.applicationName)",
                "Log an expense in \(.applicationName)",
            ],
            shortTitle: "Registrar gasto",
            systemImageName: "plus.circle.fill"
        )
    }
}
#endif
