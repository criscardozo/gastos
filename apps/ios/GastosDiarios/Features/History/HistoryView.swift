import SwiftUI

/// History (design 1e): expenses of the viewed period grouped by day, with
/// attribution avatars, the offline "pendiente" chip and swipe edit/delete.
struct HistoryView: View {
    @Environment(AppModel.self) private var model
    @State private var editingItem: ExpenseItem?
    @State private var deletingItem: ExpenseItem?
    @State private var verifyingItem: ExpenseItem?
    @State private var detailItem: ExpenseItem?
    @State private var showBankCharges = false
    /// Narrows the list to the expenses the bank has not confirmed yet.
    @State private var onlyUnverified = false

    private var l10n: L10n { model.l10n }

    private struct DayGroup: Identifiable {
        let date: CalendarDate
        let items: [ExpenseItem]
        var id: String { date.raw }
        var totalCents: Int { items.reduce(0) { $0 + $1.expense.amountCents } }
    }

    /// Expenses of the viewed period the bank has not confirmed yet.
    private var unverifiedCount: Int {
        model.viewedExpenses.filter { !$0.expense.isVerified }.count
    }

    private var visibleItems: [ExpenseItem] {
        onlyUnverified
            ? model.viewedExpenses.filter { !$0.expense.isVerified }
            : model.viewedExpenses
    }

    private var dayGroups: [DayGroup] {
        let grouped = Dictionary(grouping: visibleItems) { $0.expense.date }
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
                .padding(.bottom, unverifiedCount > 0 || !model.expenseBankCharges.isEmpty ? 8 : 12)
            verificationBar
                .padding(.horizontal, 20)
            if dayGroups.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(dayGroups) { group in
                        Section {
                            ForEach(group.items) { item in
                                row(item)
                                    .contentShape(Rectangle())
                                    .onTapGesture { detailItem = item }
                                    .listRowBackground(Theme.surface)
                                    .listRowSeparatorTint(Theme.separator)
                                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                        Button {
                                            verifyingItem = item
                                        } label: {
                                            Label(
                                                l10n.t("verify.action"),
                                                systemImage: "dollarsign.circle.fill"
                                            )
                                        }
                                        .tint(Theme.greenText)
                                    }
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
        .sheet(item: $verifyingItem) { item in
            VerifyExpenseSheet(item: item) {
                verifyingItem = nil
            }
        }
        .sheet(isPresented: $showBankCharges) {
            BankChargesSheet { showBankCharges = false }
        }
        // gastosdiarios://cargos lands here.
        .onChange(of: model.openBankChargesRequest) { _, requested in
            guard requested else { return }
            showBankCharges = true
            model.openBankChargesRequest = false
        }
        .sheet(item: $detailItem) { item in
            ExpenseDetailSheet(
                item: item,
                // Hand over to the other sheets rather than stacking on top of
                // this one: dismiss first, then present.
                onEdit: {
                    detailItem = nil
                    editingItem = item
                },
                onVerify: {
                    detailItem = nil
                    verifyingItem = item
                },
                onDelete: {
                    detailItem = nil
                    deletingItem = item
                },
                onDismiss: { detailItem = nil }
            )
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
            // Who added it lives in the detail sheet — on a two-person ledger
            // the avatar was repeated down the whole list saying very little.
            amountLabel(item)
        }
        .padding(.vertical, 2)
    }

    /// The amount, with the bank's USD charge (or its absence) underneath.
    /// The second line is the control: tapping it opens the verify sheet, so a
    /// charge can be typed in without hunting for a swipe.
    private func amountLabel(_ item: ExpenseItem) -> some View {
        let expense = item.expense
        return VStack(alignment: .trailing, spacing: 1) {
            Text(MoneyFormatter.aud(expense.amountCents, locale: l10n.locale))
                .appFont(14.5, .bold)
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
            Button {
                verifyingItem = item
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: expense.isVerified
                          ? "checkmark.circle.fill"
                          : "exclamationmark.circle.fill")
                        .font(.system(size: 10.5, weight: .semibold))
                    Text(expense.isVerified
                         ? MoneyFormatter.usd(expense.usdCents ?? 0, locale: l10n.locale)
                         : l10n.t("history.unverified"))
                        .appFont(11.5, .semibold)
                        .monospacedDigit()
                }
                .foregroundStyle(expense.isVerified ? Theme.greenText : Theme.amberText)
            }
            .buttonStyle(.plain)
        }
    }

    /// Unverified count (tap to filter) and, when the ingestion has imported
    /// charges nobody has matched yet, a chip that opens them for matching.
    @ViewBuilder
    private var verificationBar: some View {
        if unverifiedCount > 0 || !model.expenseBankCharges.isEmpty {
            HStack(spacing: 8) {
                if unverifiedCount > 0 {
                    Button {
                        onlyUnverified.toggle()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.system(size: 11, weight: .semibold))
                            Text(l10n.t("history.unverifiedCount", unverifiedCount))
                                .appFont(12, .semibold)
                        }
                        .padding(.horizontal, 11)
                        .padding(.vertical, 5)
                        .background(onlyUnverified ? Theme.accentSoft : Theme.fill)
                        .foregroundStyle(onlyUnverified ? Theme.accentStrong : Theme.inkSecondary)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                if !model.expenseBankCharges.isEmpty {
                    Button {
                        showBankCharges = true
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "creditcard.fill")
                                .font(.system(size: 11, weight: .semibold))
                            Text(l10n.bankChargesCount(model.expenseBankCharges.count))
                                .appFont(12, .semibold)
                        }
                        .padding(.horizontal, 11)
                        .padding(.vertical, 5)
                        .background(Theme.amberBg)
                        .foregroundStyle(Theme.amberText)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            .padding(.bottom, 10)
        }
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
