import SwiftUI

/// The fourth tab: everything that is not a daily action.
///
/// A menu rather than a screen. Servicios and Tarjetas are registers looked at
/// about once a month, and Ajustes less than that — putting any of them in the
/// tab bar would take width from the three that get used every day, on a phone
/// held in one hand. Adding a destination later costs a row here rather than a
/// redesign of the bar.
///
/// Built by hand instead of letting SwiftUI make its own "More" tab: that one
/// only appears past five tabs, is a plain grouped table, and carries none of
/// this app's typography or colour.
struct MoreView: View {
    @Environment(AppModel.self) private var model

    private var l10n: L10n { model.l10n }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(l10n.t("tab.more"))
                        .appFont(18, .bold)
                        .foregroundStyle(Theme.ink)
                        .padding(.bottom, 8)

                    SectionLabel(text: l10n.t("more.registers"))
                    Card {
                        VStack(spacing: 0) {
                            MoreRow(
                                icon: "calendar",
                                title: l10n.t("tab.services"),
                                subtitle: l10n.t("more.servicesHint")
                            ) { ServicesView() }
                            Divider().overlay(Theme.separator)
                            MoreRow(
                                icon: "creditcard.fill",
                                title: l10n.t("tab.cards"),
                                subtitle: l10n.t("more.cardsHint")
                            ) { CardsView() }
                        }
                    }

                    SectionLabel(text: l10n.t("more.household"))
                        .padding(.top, 8)
                    Card {
                        MoreRow(
                            icon: "gearshape.fill",
                            title: l10n.t("tab.settings"),
                            subtitle: l10n.t("more.settingsHint")
                        ) { SettingsView() }
                    }

                    // Estadísticas and Datos are deliberately absent: reading a
                    // six-column grid and driving a PDF/Excel/Drive export are
                    // desk work, and both live on the web.
                }
                .padding(16)
            }
            .background(Theme.bg)
        }
    }
}

/// One row of the menu, pushing a destination.
private struct MoreRow<Destination: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Theme.accentSoft)
                        .frame(width: 32, height: 32)
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.accentStrong)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .appFont(15, .bold)
                        .foregroundStyle(Theme.ink)
                    Text(subtitle)
                        .appFont(11.5)
                        .foregroundStyle(Theme.inkTertiary)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.inkTertiary)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
