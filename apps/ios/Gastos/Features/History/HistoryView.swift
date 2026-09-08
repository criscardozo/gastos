import SwiftUI

/// History (design 1e): expenses of the viewed period grouped by day, with
/// attribution avatars, the offline "pendiente" chip and swipe edit/delete.
struct HistoryView: View {
    @Environment(AppModel.self) private var model
    /// Rows that cannot hold their shape at the accessibility sizes give way
    /// deliberately rather than by truncating.
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var editingItem: ExpenseItem?
    @State private var deletingItem: ExpenseItem?
    @State private var verifyingItem: ExpenseItem?
    @State private var detailItem: ExpenseItem?
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

            // The charges as a PANEL, not behind a chip: a chip is easy not to
            // notice, and a charge nobody looks at is a purchase missing from
            // the ledger. It collapses to one line when nothing is waiting, so
            // the prominence costs the list nothing on a quiet day.
            BankChargesPanel()
                .padding(.horizontal, 20)
                .padding(.bottom, 10)
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
                                    // ONE element for the row, not a trait on
                                    // the container.
                                    //
                                    // `.accessibilityAddTraits(.isButton)` on
                                    // its own propagates to every child, and
                                    // the runtime tree showed what that costs:
                                    // the category icon became a *button*
                                    // called "doc.plaintext.fill", beside two
                                    // more buttons for the note and the
                                    // category. `.combine` merges the row's
                                    // text into one label instead, which is
                                    // also how it reads out loud — an amount,
                                    // a note and a category, once.
                                    .accessibilityElement(children: .combine)
                                    .accessibilityAddTraits(.isButton)
                                    .accessibilityAction { detailItem = item }
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
        // gastos://cargos lands here.
        .onChange(of: model.openBankChargesRequest) { _, requested in
            guard requested else { return }
            // There is no sheet to open any more — the panel is already on
            // this screen and opens itself when something is waiting, so
            // arriving here IS the answer.
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
        .newExpenseButton()
    }

    // MARK: Pieces

    private var header: some View {
        AdaptiveRow {
            Text(l10n.t("tab.history"))
                .appFont(18, .bold)
                .foregroundStyle(Theme.ink)
            AdaptiveGap()
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
            RichText.text([
                .init(
                    dayName(group.date),
                    color: Theme.ink, font: AppFont.font(13, .bold)
                ),
                .init(
                    " · \(daySubtitle(group.date))",
                    color: Theme.inkTertiary, font: AppFont.font(13, .medium)
                ),
            ])
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
        // Beside each other normally; the amount drops below the name once the
        // text is big.
        //
        // Sharing the row at an accessibility size left the name about half the
        // screen, and a single long word — "Telefonía" — is wider than that, so
        // it came apart as "Telefoní / a". Splitting a word is not a line
        // break; giving the name the full width is what actually fixes it.
        let layout: AnyLayout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 11))
        return layout {
            CategoryCircle(categoryId: item.expense.categoryId, category: category, size: 38)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.expense.note.isEmpty
                     ? l10n.categoryName(category)
                     : item.expense.note)
                    .appFont(14.5, .semibold)
                    .foregroundStyle(Theme.ink)
                    // One line normally — the list is meant to be scanned —
                    // but two once the text is big, because at the
                    // accessibility sizes one line meant "Telefon…" and the
                    // note is the whole reason a row is recognisable.
                    .lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
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
            if !typeSize.isAccessibilitySize { Spacer() }
            // Who added it lives in the detail sheet — on a two-person ledger
            // the avatar was repeated down the whole list saying very little.
            amountLabel(item)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }

    /// The amount, with the bank's USD charge (or its absence) underneath.
    /// The second line is the control: tapping it opens the verify sheet, so a
    /// charge can be typed in without hunting for a swipe.
    private func amountLabel(_ item: ExpenseItem) -> some View {
        let expense = item.expense
        return VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 1) {
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
                        // The text next to it says the same thing.
                        .accessibilityHidden(true)
                    Text(expense.isVerified
                         ? MoneyFormatter.usd(expense.usdCents ?? 0, locale: l10n.locale)
                         : l10n.t("history.unverified"))
                        .appFont(11.5, .semibold)
                        .monospacedDigit()
                        // Never squeezed narrower than the word it holds. Left
                        // to the HStack it was compressed until it broke mid
                        // word — "Sin verifica / r" — which is not a line
                        // break, it is a word coming apart.
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(expense.isVerified ? Theme.greenText : Theme.infoText)
            }
            .buttonStyle(.plain)

            // An expense nobody typed says so, and offers the way back.
            //
            // The undo is on the row rather than in a menu because its window
            // is short: it lasts exactly as long as the charge does — 48 hours
            // — and then the sweep takes the charge and this becomes an
            // ordinary expense.
            // An amount worked out from the learned rate, not one anybody
            // stated. On the row rather than only in the detail, because an
            // estimate nobody can see is just a number — and the row is where
            // you would notice it was off.
            if expense.isEstimated {
                Text(l10n.t("recurring.estimated"))
                    .appFont(11, .semibold)
                    .foregroundStyle(Theme.amberText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if expense.isAutomatic, let id = expense.id {
                Button {
                    model.undoRecurring(expenseId: id)
                } label: {
                    Image(systemName: "arrow.uturn.backward")
                        .appFont(10.5, .semibold)
                        .foregroundStyle(Theme.inkTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    "\(l10n.t("recurring.undo")) — \(l10n.t("recurring.autoBadge"))"
                )
            }
        }
    }

    /// Unverified count (tap to filter) and, when the ingestion has imported
    /// charges nobody has matched yet, a chip that opens them for matching.
    /// A capsule while the chip is one line, a rounded rectangle once it wraps
    /// — a capsule around three lines of text is a circle with words in it.
    private var chipShape: AnyShape {
        typeSize.isAccessibilitySize
            ? AnyShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            : AnyShape(Capsule())
    }

    @ViewBuilder
    private var verificationBar: some View {
        if unverifiedCount > 0 || !model.expenseBankCharges.isEmpty {
            // The two chips sit side by side until neither fits: at an
            // accessibility size they were two round blobs with their labels
            // broken mid-word ("verific" over "ar").
            AdaptiveRow(spacing: 8) {
                if unverifiedCount > 0 {
                    Button {
                        onlyUnverified.toggle()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .appFont(11, .semibold)
                                .accessibilityHidden(true)
                            Text(l10n.t("history.unverifiedCount", unverifiedCount))
                                .appFont(12, .semibold)
                        }
                        .padding(.horizontal, 11)
                        .padding(.vertical, 5)
                        .background(onlyUnverified ? Theme.accentSoft : Theme.fill)
                        .foregroundStyle(onlyUnverified ? Theme.accentStrong : Theme.inkSecondary)
                        .clipShape(chipShape)
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
