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
        let l10n = model.l10n
        TabView {
            QuickEntryView()
                .tabItem {
                    Label(l10n.t("tab.new"), systemImage: "plus.circle.fill")
                }
            SummaryView()
                .tabItem {
                    Label(l10n.t("tab.summary"), systemImage: "chart.pie.fill")
                }
            HistoryView()
                .tabItem {
                    Label(l10n.t("tab.history"), systemImage: "list.bullet.rectangle.fill")
                }
            SettingsView()
                .tabItem {
                    Label(l10n.t("tab.settings"), systemImage: "gearshape.fill")
                }
        }
    }
}
