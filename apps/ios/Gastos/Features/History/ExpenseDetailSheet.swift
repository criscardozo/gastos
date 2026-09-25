import SwiftUI

/// Everything known about one expense, on tapping its row.
///
/// The list is deliberately terse — amount, note, state — so the details that
/// only matter when you are actually asking about a particular expense live
/// here: which period it fell into, who added it, when it was created and last
/// touched, and what the bank charged for it.
struct ExpenseDetailSheet: View {
    @Environment(AppModel.self) private var model
    let item: ExpenseItem
    var onEdit: () -> Void
    var onVerify: () -> Void
    var onDelete: () -> Void
    var onDismiss: () -> Void

    private var l10n: L10n { model.l10n }
    private var expense: Expense { item.expense }
    private var category: Category {
        model.household?.categories[expense.categoryId] ?? .missing
    }
    private var member: MemberProfile? {
        model.household?.memberProfiles[expense.createdBy]
    }
    private var date: CalendarDate? { CalendarDate(expense.date) }

    /// The materialized period whose range contains this expense's date.
    private var period: PeriodBudget? {
        guard let date else { return nil }
        return model.periods.first { $0.contains(date) }
    }

    /// usd / aud for a verified expense — the bank's own rate for this charge.
    private var impliedRate: Double? {
        guard let usd = expense.usdCents, expense.isVerified, expense.amountCents > 0
        else { return nil }
        return Double(usd) / Double(expense.amountCents)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    hero
                    verificationCard
                    factsCard
                    actions
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(l10n.t("detail.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(l10n.t("common.done")) { onDismiss() }
                        .appFont(15, .semibold)
                }
            }
        }
        .presentationDragIndicator(.visible)
    }

    // MARK: Pieces

    private var hero: some View {
        VStack(spacing: 10) {
            CategoryCircle(
                categoryId: expense.categoryId,
                category: category,
                size: 54
            )
            Text(MoneyFormatter.aud(expense.amountCents, locale: l10n.locale))
                .amountStyle(40, .bold)
                .kerning(-0.03 * 40)
                .foregroundStyle(Theme.ink)
            if !expense.note.isEmpty {
                Text(expense.note)
                    .appFont(15, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                    .multilineTextAlignment(.center)
            }
            HStack(spacing: 6) {
                Text(l10n.categoryName(category))
                    .appFont(12.5, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 5)
                    .background(Theme.fill)
                    .clipShape(Capsule())
                // Spending that doesn't eat the period budget is worth saying
                // out loud: it explains a total that looks too low.
                if !category.isBudgeted {
                    Text(l10n.t("detail.offBudget"))
                        .appFont(12.5, .semibold)
                        .foregroundStyle(Theme.accentStrong)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 5)
                        .background(Theme.accentSoft)
                        .clipShape(Capsule())
                }
            }
            if item.hasPendingWrites {
                HStack(spacing: 4) {
                    Image(systemName: "icloud.slash")
                        .font(.system(size: 11, weight: .medium))
                    Text(l10n.t("history.pending"))
                        .appFont(12)
                }
                .foregroundStyle(Theme.inkTertiary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
    }

    private var verificationCard: some View {
        Card(padding: EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16)) {
            HStack(spacing: 11) {
                Image(systemName: expense.isVerified
                      ? "checkmark.circle.fill"
                      : "exclamationmark.circle.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(expense.isVerified ? Theme.greenText : Theme.infoText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(l10n.t(expense.isVerified ? "history.verified" : "history.unverified"))
                        .appFont(14.5, .semibold)
                        .foregroundStyle(Theme.ink)
                    if expense.isVerified, let usd = expense.usdCents {
                        Text(MoneyFormatter.usd(usd, locale: l10n.locale)
                             + (impliedRate.map { " · " + l10n.t("detail.rate", rateText($0)) } ?? ""))
                            .appFont(12.5, .semibold)
                            .monospacedDigit()
                            .foregroundStyle(Theme.inkSecondary)
                    } else {
                        Text(l10n.t("detail.unverifiedHint"))
                            .appFont(12)
                            .foregroundStyle(Theme.inkTertiary)
                    }
                }
                Spacer()
                Button(l10n.t("verify.action")) { onVerify() }
                    .appFont(13, .semibold)
                    .foregroundStyle(Theme.accentStrong)
            }
        }
    }

    private var factsCard: some View {
        Card(padding: EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)) {
            VStack(spacing: 0) {
                if let date {
                    factRow(
                        l10n.t("detail.date"),
                        l10n.longDate(date, timeZone: model.householdTimeZone)
                    )
                }
                if let period, let start = period.start, let end = period.end {
                    divider
                    factRow(
                        l10n.t("detail.period"),
                        l10n.periodRangeCompact(
                            start: start, end: end, timeZone: model.householdTimeZone
                        )
                    )
                }
                divider
                factRow(
                    l10n.t("detail.createdBy"),
                    member?.displayName ?? l10n.t("detail.unknownMember")
                )
                if let createdAt = expense.createdAt {
                    divider
                    factRow(l10n.t("detail.created"), l10n.shortDate(createdAt))
                }
                // Only worth a row when it actually differs from the creation.
                if let updatedAt = expense.updatedAt,
                   let createdAt = expense.createdAt,
                   abs(updatedAt.timeIntervalSince(createdAt)) > 60 {
                    divider
                    factRow(l10n.t("detail.updated"), l10n.shortDate(updatedAt))
                }
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 10) {
            PrimaryCTA(
                title: l10n.t("history.edit"),
                icon: "pencil",
                height: 52
            ) {
                onEdit()
            }
            Button(l10n.t("history.delete")) { onDelete() }
                .appFont(14, .semibold)
                .foregroundStyle(Theme.redText)
        }
        .padding(.top, 2)
    }

    private var divider: some View {
        Divider().overlay(Theme.separator)
    }

    private func factRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .appFont(13.5)
                .foregroundStyle(Theme.inkSecondary)
            Spacer()
            Text(value)
                .appFont(13.5, .semibold)
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 12)
    }

    /// "0,652" — three decimals is where a bank rate stops being noise.
    private func rateText(_ rate: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = l10n.locale
        formatter.minimumFractionDigits = 3
        formatter.maximumFractionDigits = 3
        return formatter.string(from: NSNumber(value: rate)) ?? "—"
    }
}
