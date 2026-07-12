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
                    .sheet(isPresented: $model.showNewPeriodSheet, onDismiss: {
                        model.markNewPeriodSeen()
                    }) {
                        NewPeriodSheet()
                    }
            }
        }
        .tint(Theme.accent)
        .environment(\.locale, model.l10n.locale)
        .animation(.easeInOut(duration: 0.25), value: model.phase)
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
