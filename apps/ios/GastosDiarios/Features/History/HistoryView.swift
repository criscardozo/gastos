import SwiftUI

/// History (design 1e): expenses of the viewed period grouped by day, with
/// attribution avatars, the offline "pendiente" chip and swipe edit/delete.
struct HistoryView: View {
    @Environment(AppModel.self) private var model
    @State private var editingItem: ExpenseItem?
    @State private var deletingItem: ExpenseItem?

    private var l10n: L10n { model.l10n }

    private struct DayGroup: Identifiable {
        let date: CalendarDate
        let items: [ExpenseItem]
        var id: String { date.raw }
        var totalCents: Int { items.reduce(0) { $0 + $1.expense.amountCents } }
    }

    private var dayGroups: [DayGroup] {
        let grouped = Dictionary(grouping: model.viewedExpenses) { $0.expense.date }
        return grouped.keys.sorted(by: >).compactMap { raw in
            guard let date = CalendarDate(raw) else { return nil }
            return DayGroup(date: date, items: grouped[raw] ?? [])
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 20)
                .padding(.top, 6)
                .padding(.bottom, 12)
            if dayGroups.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(dayGroups) { group in
                        Section {
                            ForEach(group.items) { item in
                                row(item)
                                    .listRowBackground(Theme.surface)
                                    .listRowSeparatorTint(Theme.separator)
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        Button(role: .destructive) {
                                            deletingItem = item
                                        } label: {
                                            Label(l10n.t("history.delete"), systemImage: "trash.fill")
                                        }
                                        .tint(Theme.red)
                                        Button {
                                            editingItem = item
                                        } label: {
                                            Label(l10n.t("history.edit"), systemImage: "pencil")
                                        }
                                        .tint(Color(hex: "#2A6FDB"))
                                    }
                            }
                        } header: {
                            dayHeader(group)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .environment(\.defaultMinListHeaderHeight, 10)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .sheet(item: $editingItem) { item in
            ExpenseFormView(mode: .edit(item)) {
                editingItem = nil
            }
        }
        .confirmationDialog(
            l10n.t("history.delete.confirm"),
            isPresented: Binding(
                get: { deletingItem != nil },
                set: { if !$0 { deletingItem = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(l10n.t("history.delete"), role: .destructive) {
                if let id = deletingItem?.expense.id {
                    model.deleteExpense(id: id)
                }
                deletingItem = nil
            }
            Button(l10n.t("common.cancel"), role: .cancel) {
                deletingItem = nil
            }
        }
    }

    // MARK: Pieces

    private var header: some View {
        HStack {
            Text(l10n.t("tab.history"))
                .appFont(18, .bold)
                .foregroundStyle(Theme.ink)
            Spacer()
            if let period = model.viewedPeriod, let start = period.start, let end = period.end {
                PeriodNavigator(
                    label: l10n.periodRangeCompact(start: start, end: end, timeZone: model.householdTimeZone),
                    canGoBack: (model.viewedPeriodIndex ?? 0) > 0,
                    canGoForward: (model.viewedPeriodIndex ?? 0) < model.periods.count - 1,
                    onBack: { model.navigatePeriod(by: -1) },
                    onForward: { model.navigatePeriod(by: 1) }
                )
            }
        }
    }

    private func dayHeader(_ group: DayGroup) -> some View {
        HStack(alignment: .firstTextBaseline) {
            (
                Text(dayName(group.date))
                    .foregroundColor(Theme.ink)
                    .fontWeight(.bold)
                + Text(verbatim: " · \(daySubtitle(group.date))")
                    .foregroundColor(Theme.inkTertiary)
                    .fontWeight(.medium)
            )
            .appFont(13)
            Spacer()
            Text(MoneyFormatter.aud(group.totalCents, locale: l10n.locale))
                .appFont(12.5, .semibold)
                .monospacedDigit()
                .foregroundStyle(Theme.inkSecondary)
        }
        .textCase(nil)
    }

    /// "Hoy" / "Ayer" / "Jueves" — like the design's day headers.
    private func dayName(_ date: CalendarDate) -> String {
        if date == model.today { return l10n.t("history.today") }
        if date == PeriodLogic.addDays(model.today, -1) { return l10n.t("history.yesterday") }
        return l10n.weekdayName(date, timeZone: model.householdTimeZone).capitalized
    }

    /// "sábado 11 jul" for today/yesterday, "9 jul" otherwise (per design 1e).
    private func daySubtitle(_ date: CalendarDate) -> String {
        if date == model.today || date == PeriodLogic.addDays(model.today, -1) {
            return l10n.dayHeader(date, timeZone: model.householdTimeZone)
        }
        return l10n.dayMonth(date, timeZone: model.householdTimeZone)
    }

    private func row(_ item: ExpenseItem) -> some View {
        // Deleted categories fall back to the gray "Otros" placeholder.
        let category = model.household?.categories[item.expense.categoryId] ?? .missing
        let member = model.household?.memberProfiles[item.expense.createdBy]
        return HStack(spacing: 11) {
            CategoryCircle(categoryId: item.expense.categoryId, category: category, size: 38)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.expense.note.isEmpty
                     ? l10n.categoryName(category)
                     : item.expense.note)
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    if !item.expense.note.isEmpty {
                        Text(l10n.categoryName(category))
                            .appFont(12)
                            .foregroundStyle(Theme.inkTertiary)
                    }
                    if item.hasPendingWrites {
                        HStack(spacing: 3) {
                            Image(systemName: "icloud.slash")
                                .font(.system(size: 10, weight: .medium))
                            Text(l10n.t("history.pending"))
                                .appFont(12)
                        }
                        .foregroundStyle(Theme.inkSecondary)
                    }
                }
            }
            Spacer()
            amountLabel(item.expense)
            MemberAvatar(profile: member, size: 22)
        }
        .padding(.vertical, 2)
    }

    /// The expense amount, right-aligned.
    private func amountLabel(_ expense: Expense) -> some View {
        Text(MoneyFormatter.aud(expense.amountCents, locale: l10n.locale))
            .appFont(14.5, .bold)
            .monospacedDigit()
            .foregroundStyle(Theme.ink)
    }

    private var emptyState: some View {
        VStack {
            Card(padding: EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16)) {
                HStack(spacing: 12) {
                    Image(systemName: "list.bullet.rectangle")
                        .font(.system(size: 22))
                        .foregroundStyle(Theme.inkTertiary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(l10n.t("empty.expenses.title"))
                            .appFont(13.5, .bold)
                            .foregroundStyle(Theme.ink)
                        Text(l10n.t("empty.expenses.body"))
                            .appFont(12)
                            .foregroundStyle(Theme.inkTertiary)
                    }
                    Spacer()
                }
            }
            .padding(.horizontal, 20)
            Spacer()
        }
    }
}
