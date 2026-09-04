import SwiftUI

/// Auth state → onboarding or the main tab bar.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            switch model.phase {
            case .loading:
                ZStack {
                    Theme.bg.ignoresSafeArea()
                    ProgressView()
                        .tint(Theme.accent)
                }
            case .signedOut, .onboarding:
                OnboardingView()
            case .ready:
                MainTabView()
                    // Full screen, and deliberately not dismissable: a period
                    // starting is a question, and swiping it away used to
                    // answer it silently with the default budget.
                    .fullScreenCover(isPresented: $model.showNewPeriodSheet) {
                        NewPeriodScreen(manual: model.newPeriodPromptIsManual)
                    }
            }
        }
        .tint(Theme.accent)
        // A refused write is worth interrupting for: the change looks applied
        // in the local cache and is saved nowhere, so a banner that scrolls
        // away would leave the app quietly lying. Not shown when merely
        // offline — Firestore queues those writes instead of failing them.
        .alert(
            model.l10n.t("error.write.title"),
            isPresented: Binding(
                get: { model.writeError != nil },
                set: { if !$0 { model.writeError = nil } }
            ),
            presenting: model.writeError
        ) { _ in
            Button(model.l10n.t("common.done")) { model.writeError = nil }
        } message: { detail in
            Text("\(model.l10n.t("error.write.body"))\n\n\(detail)")
        }
        .environment(\.locale, model.l10n.locale)
        // Manual appearance override (Sistema/Claro/Oscuro in Settings).
        .preferredColorScheme(model.appearance.colorScheme)
        .animation(.easeInOut(duration: 0.25), value: model.phase)
    }
}

extension AppModel.AppearanceMode {
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// Nuevo gasto / Resumen / Historial / Más.
///
/// Four tabs, and the fourth is a menu. The three that carry the bar are the
/// ones used every day; Servicios, Tarjetas and Ajustes are consulted about
/// once a month and would only shrink the targets that matter if they sat
/// beside them. A hand-built menu rather than SwiftUI's automatic "More" —
/// that one appears past five tabs, is a plain system table, and cannot be
/// dressed in this app's own design.
struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        let l10n = model.l10n
        // Five destinations and no "Nuevo".
        //
        // Loading an expense is an action, not a place, so it lives as a
        // button on the two screens you would be looking at when you need it
        // — and reachable from anywhere else through Back Tap, a Shortcut, the
        // Control or the widget. What the bar carries instead is the five
        // things you can be looking AT, which is what a tab bar is for.
        //
        // The old Más menu is gone with it: with entry out of the bar there
        // was room for the three screens it held, and a menu whose every row
        // is now a tab is a menu with nothing left to do.
        TabView(selection: $model.selectedTab) {
            SummaryView()
                .tabItem {
                    Label(l10n.t("tab.summary"), systemImage: "chart.pie.fill")
                }
                .tag(AppModel.MainTab.summary)
            HistoryView()
                .tabItem {
                    Label(l10n.t("tab.history"), systemImage: "list.bullet.rectangle.fill")
                }
                .tag(AppModel.MainTab.history)
            // These three were pushed from Más and still set navigation
            // titles, so each brings its own stack now.
            NavigationStack { CardsView() }
                .tabItem {
                    Label(l10n.t("tab.cards"), systemImage: "creditcard.fill")
                }
                .tag(AppModel.MainTab.cards)
            NavigationStack { ServicesView() }
                .tabItem {
                    Label(l10n.t("tab.services"), systemImage: "calendar")
                }
                .tag(AppModel.MainTab.services)
            NavigationStack { SettingsView() }
                .tabItem {
                    Label(l10n.t("tab.settings"), systemImage: "gearshape.fill")
                }
                .tag(AppModel.MainTab.settings)
        }
        .sheet(isPresented: $model.showQuickEntry) {
            QuickEntryView { model.showQuickEntry = false }
        }
    }
}
