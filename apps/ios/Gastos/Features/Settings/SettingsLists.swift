import SwiftUI

/// The two lists Settings used to print in full (Registro and Pagos desde
/// Atajos). Both only grow, and neither is something you change, so Settings
/// shows one row into each and the list lives here, pushed on its stack.

// MARK: - Past periods

struct PastPeriodsView: View {
    @Environment(AppModel.self) private var model

    private var l10n: L10n { model.l10n }

    var body: some View {
        let past = model.pastPeriods
        ScrollView {
            Card {
                VStack(spacing: 0) {
                    ForEach(Array(past.enumerated()), id: \.element.startDate) { index, period in
                        AdaptiveRow {
                            if let start = period.start, let end = period.end {
                                Text(l10n.periodRangeCompact(start: start, end: end, timeZone: model.householdTimeZone))
                                    .appFont(13.5, .semibold)
                                    .foregroundStyle(Theme.ink)
                            }
                            AdaptiveGap()
                            Text("\(l10n.t("period.\(period.period.rawValue)")) · \(MoneyFormatter.audCompact(period.amountCents, locale: l10n.locale))")
                                .appFont(13)
                                .monospacedDigit()
                                .foregroundStyle(Theme.inkSecondary)
                        }
                        .padding(.vertical, 12)
                        if index < past.count - 1 {
                            Divider().overlay(Theme.separator)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(l10n.t("settings.log"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Payments from Shortcuts (diagnostic)

struct PaymentRunsView: View {
    @Environment(AppModel.self) private var model
    @State private var runs = PaymentRunLog()

    private var l10n: L10n { model.l10n }

    var body: some View {
        ScrollView {
            Card {
                VStack(alignment: .leading, spacing: 0) {
                    if runs.entries.isEmpty {
                        Text(l10n.t("paymentRuns.empty"))
                            .appFont(13.5)
                            .foregroundStyle(Theme.inkSecondary)
                            .padding(.vertical, 13)
                    }
                    ForEach(Array(runs.entries.enumerated()), id: \.element.id) { index, run in
                        row(run)
                        if index < runs.entries.count - 1 {
                            Divider().overlay(Theme.separator)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        // Re-read on every visit: the actions write from the background while
        // this screen may already exist.
        .onAppear { runs = PaymentRunLog.load(from: .standard) }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(l10n.t("paymentRuns.title"))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Shows what Shortcuts handed over verbatim, so an empty or odd value is
    /// visible as such rather than formatted into something plausible.
    private func row(_ run: PaymentRunLog.Entry) -> some View {
        let missing = l10n.t("paymentRuns.missing")
        let outcome: String = switch run.outcome {
        case PaymentRunLog.running: l10n.t("paymentRuns.running")
        case "saved": l10n.t("paymentRuns.saved")
        case "savedOffline": l10n.t("paymentRuns.savedOffline")
        default: run.outcome
        }
        return VStack(alignment: .leading, spacing: 3) {
            Text(run.startedAt.formatted(.dateTime.day().month().hour().minute().second().locale(l10n.locale)))
                .appFont(11.5)
                .foregroundStyle(Theme.inkTertiary)
            Text("\(run.amount ?? missing) \(run.currency ?? "") · \(run.merchant ?? missing)")
                .appFont(13.5, .semibold)
                .foregroundStyle(Theme.ink)
            Text(outcome)
                .appFont(12.5)
                .foregroundStyle(Theme.inkSecondary)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 11)
    }
}
