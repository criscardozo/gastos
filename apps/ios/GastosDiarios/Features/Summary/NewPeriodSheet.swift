import SwiftUI

/// New-period bottom sheet (design 2a): shown the first time the app opens
/// inside a freshly materialized (source "default") period. The amount is
/// editable; the period TYPE is fixed once materialized (Firestore rules make
/// startDate/endDate/period immutable — deletes are denied too).
struct NewPeriodSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var budget = BudgetEntryAmount()
    @State private var loaded = false
    @State private var editingAmount = false

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }
    private var period: PeriodBudget? { model.currentPeriod }
    private var isWeekly: Bool { period?.period == .weekly }

    var body: some View {
        VStack(spacing: 16) {
            Capsule()
                .fill(Theme.ink.opacity(0.15))
                .frame(width: 40, height: 5)
                .padding(.top, 14)

            VStack(alignment: .leading, spacing: 3) {
                Text(l10n.t(isWeekly ? "newPeriod.title.weekly" : "newPeriod.title.fortnightly"))
                    .appFont(20, .bold)
                    .foregroundStyle(Theme.ink)
                if let period, let start = period.start, let end = period.end {
                    Text("\(l10n.periodRange(start: start, end: end, timeZone: model.householdTimeZone)) · \(l10n.t("newPeriod.question"))")
                        .appFont(13.5)
                        .foregroundStyle(Theme.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 14) {
                BudgetAmountEditor(value: $budget, showsCurrencyCode: false, showsEditIcon: true)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture { editingAmount = true }

                if isDefaultAmount {
                    Text(l10n.t("newPeriod.defaultBadge"))
                        .appFont(11.5, .bold)
                        .foregroundStyle(Theme.greenText)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 4)
                        .background(Theme.greenBg)
                        .clipShape(Capsule())
                }

                // Period type is recorded at materialization and immutable
                // afterwards → segmented shown fixed.
                SegmentedPill(
                    options: [
                        (PeriodType.weekly, l10n.t("period.weekly")),
                        (PeriodType.fortnightly, l10n.t("period.fortnightly")),
                    ],
                    selection: .constant(period?.period ?? .fortnightly),
                    isEnabled: false
                )
            }
            .padding(18)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )

            if editingAmount {
                KeypadView(separatorLabel: separator) { key in
                    budget.tap(key)
                }
            } else {
                Text(l10n.t(isWeekly ? "newPeriod.foot.weekly" : "newPeriod.foot.fortnightly"))
                    .appFont(12)
                    .foregroundStyle(Theme.inkTertiary)
                    .multilineTextAlignment(.center)
            }

            Spacer(minLength: 0)

            PrimaryCTA(
                title: l10n.t(isWeekly ? "newPeriod.start.weekly" : "newPeriod.start.fortnightly"),
                height: 56,
                enabled: budget.audCents > 0
            ) {
                model.confirmNewPeriod(amountCents: budget.audCents)
                dismiss()
            }
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 24)
        .background(Theme.bg.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
        .onAppear {
            guard !loaded else { return }
            loaded = true
            budget = .fromAUDCents(period?.amountCents ?? 0)
        }
    }

    private var isDefaultAmount: Bool {
        budget.audCents == model.household?.defaultBudget.amountCents
    }
}
