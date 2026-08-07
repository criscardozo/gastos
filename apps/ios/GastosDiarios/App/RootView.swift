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

/// Nuevo gasto / Resumen / Historial / Ajustes.
struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        let l10n = model.l10n
        TabView(selection: $model.selectedTab) {
            QuickEntryView()
                .tabItem {
                    Label(l10n.t("tab.new"), systemImage: "plus.circle.fill")
                }
                .tag(AppModel.MainTab.entry)
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
            SettingsView()
                .tabItem {
                    Label(l10n.t("tab.settings"), systemImage: "gearshape.fill")
                }
                .tag(AppModel.MainTab.settings)
        }
    }
}
