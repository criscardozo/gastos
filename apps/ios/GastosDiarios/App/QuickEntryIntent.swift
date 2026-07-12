import AppIntents

// Back Tap cannot be intercepted by apps directly — it triggers a Shortcut,
// and this App Intent is what that Shortcut runs. Wiring (documented in
// apps/ios/README.md): Settings → Accessibility → Touch → Back Tap →
// Double Tap → "Registrar gasto".

/// Opens the app straight on the quick-entry screen.
struct QuickEntryIntent: AppIntent {
    static let title: LocalizedStringResource = "Registrar gasto"
    static let description = IntentDescription("Abre la carga rápida de gastos.")
    /// Foreground intent: runs in-process with the app open.
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.requestQuickEntry()
        return .result()
    }
}

/// Exposes the intent in the Shortcuts app (and to Siri) with zero setup.
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
