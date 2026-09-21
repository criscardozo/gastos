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
    /// Whether the bank's section is expanded. Open when something is waiting,
    /// closed when not — and once you have said which by hand, that wins. Nil
    /// means nobody has said.
    @State private var bankOpenedByHand: Bool?
    /// The charge whose sheet is up.
    @State private var decidingCharge: BankCharge?
    /// The recoverable-dismissals sheet.
    @State private var showingDismissed = false
    /// Asking before confirming every guess at once. Assigning DELETES the
    /// charge, so a bulk mistake cannot be walked back the way a dismissal can.
    @State private var confirmingAll = false

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

    private var bankIsOpen: Bool {
        bankOpenedByHand ?? !model.expenseBankCharges.isEmpty
    }

    /// Charge → expense for every row that currently HAS an answer on it.
    ///
    /// Exactly what the rows say, which is the same set of taps in one press
    /// rather than a second opinion with a rule of its own. A charge whose
    /// suggestion is empty — nothing scored above BankMatch.minScore — is not
    /// in here and is left for a person to answer.
    private var pendingGuesses: [(charge: BankCharge, expenseId: String)] {
        model.bankChargeSuggestions.compactMap { suggestion in
            guard
                let charge = model.expenseBankCharges.first(where: { $0.id == suggestion.chargeId }),
                let expenseId = suggestion.expenseId,
                !expenseId.isEmpty
            else { return nil }
            return (charge, expenseId)
        }
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

            List {
                // The bank's charges as a SECTION of this list, above the days.
                //
                // They were a panel: their own blue header, a hint line and a
                // card per charge, which cost about half the screen for one
                // charge and read as a second screen stapled to the top of this
                // one. Now a charge is a row the same shape as an expense and
                // the deciding happens in a sheet.
                //
                // Above the days, though, and never behind a chip alone — a
                // charge nobody looks at is a purchase missing from the ledger,
                // which is what the panel's prominence was for. Prominence is
                // the position, not the height.
                bankSection
                if dayGroups.isEmpty {
                    Section {
                        emptyState
                            .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                } else {
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
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListHeaderHeight, 10)
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
            // There is no sheet to open — the charges are rows on this screen,
            // so arriving here IS the answer. What it does do is undo a fold:
            // following a link to the charges and finding the section collapsed
            // because you closed it yesterday is the link not working.
            bankOpenedByHand = nil
            model.openBankChargesRequest = false
        }
        .sheet(item: $decidingCharge) { charge in
            BankChargeSheet(
                charge: charge,
                suggestion: model.bankChargeSuggestions
                    .first { $0.chargeId == charge.id },
                onDone: { decidingCharge = nil }
            )
        }
        .sheet(isPresented: $showingDismissed) {
            DismissedChargesSheet(onDone: { showingDismissed = false })
        }
        .alert(l10n.t("bank.confirmAllTitle"), isPresented: $confirmingAll) {
            Button(l10n.t("common.cancel"), role: .cancel) {}
            Button(l10n.t("bank.confirmAllGo")) { confirmAll() }
        } message: {
            Text(l10n.t("bank.confirmAllBody", pendingGuesses.count))
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
        sectionHeader(
            title: [
                .init(
                    dayName(group.date),
                    color: Theme.ink, font: AppFont.font(13, .bold)
                ),
                .init(
                    " · \(daySubtitle(group.date))",
                    color: Theme.inkTertiary, font: AppFont.font(13, .medium)
                ),
            ],
            trailing: MoneyFormatter.aud(group.totalCents, locale: l10n.locale)
        )
    }

    /// A section header: what it is on the left, its total on the right.
    ///
    /// The row becomes a column at an accessibility size, and the Spacer goes
    /// with it — in a VStack a Spacer expands downwards, and side by side the
    /// total wrapped onto a second line UNDER the title it was meant to sit
    /// beside ("Del banco · 3 US$" / "79,30"). Measured at AX5.
    ///
    /// One function for both headers because the bank's was written by copying
    /// the day's, which is how the day's defect would have survived next to a
    /// fixed copy of itself.
    private func sectionHeader(
        title: [RichText.Run],
        trailing: String?
    ) -> some View {
        let layout: AnyLayout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        return layout {
            RichText.text(title)
            if !typeSize.isAccessibilitySize { Spacer() }
            if let trailing {
                Text(trailing)
                    .appFont(12.5, .semibold)
                    .monospacedDigit()
                    .foregroundStyle(Theme.inkSecondary)
            }
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
        let pending = model.expenseBankCharges.count
        if unverifiedCount > 0 || pending > 0 {
            // Both counts on ONE line. The bank's used to be a full-width blue
            // bar of its own below this one, so two numbers cost three lines
            // before anything you came to read — measured on the phone with a
            // single charge and a single unverified expense.
            //
            // Side by side until neither fits: at an accessibility size they
            // were two round blobs with their labels broken mid-word ("verific"
            // over "ar"), which is what AdaptiveRow is for.
            AdaptiveRow(spacing: 8) {
                if unverifiedCount > 0 {
                    chip(
                        icon: "exclamationmark.circle.fill",
                        label: l10n.t("history.unverifiedCount", unverifiedCount),
                        on: onlyUnverified,
                        onColor: Theme.accentStrong,
                        onBackground: Theme.accentSoft
                    ) { onlyUnverified.toggle() }
                }
                if pending > 0 {
                    // Folds the section rather than opening a screen: the rows
                    // are right there, and a chip that hid them behind a sheet
                    // is exactly what this stopped being.
                    chip(
                        icon: bankIsOpen ? "chevron.up" : "chevron.down",
                        label: l10n.bankChipCount(pending),
                        on: bankIsOpen,
                        onColor: Theme.infoText,
                        onBackground: Theme.infoBg
                    ) { bankOpenedByHand = !bankIsOpen }
                }
                // AdaptiveGap, not Spacer: at an accessibility size AdaptiveRow
                // is a VStack, and a Spacer in a VStack expands DOWNWARDS. The
                // bare Spacer that used to be here pushed the whole list off
                // the bottom of the screen — measured at AX5, where the charges
                // ended up behind the tab bar with a gap above them the height
                // of half the screen. It predates this section; it was found
                // by running the new one at that size.
                AdaptiveGap()
            }
            .padding(.bottom, 10)
        }
    }

    private func chip(
        icon: String,
        label: String,
        on: Bool,
        onColor: Color,
        onBackground: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .appFont(11, .semibold)
                    // The label beside it says the same thing.
                    .accessibilityHidden(true)
                Text(label)
                    .appFont(12, .semibold)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 5)
            .background(on ? onBackground : Theme.fill)
            .foregroundStyle(on ? onColor : Theme.inkSecondary)
            .clipShape(chipShape)
        }
        .buttonStyle(.plain)
    }

    /// The bank's charges: one row each, a way to confirm the lot, and the way
    /// back from a dismissal.
    @ViewBuilder
    private var bankSection: some View {
        let charges = model.expenseBankCharges
        let dismissed = model.dismissedBankCharges.count
        // Folded means GONE, header and all, not an empty section: kept, it was
        // a lone header over a gap, and the chip above already carries the
        // count that header would be repeating.
        if (!charges.isEmpty || dismissed > 0) && bankIsOpen {
            Section {
                Group {
                    // Every charge, not the first two. The old cards were tall
                    // enough that five of them buried the history, so the panel
                    // showed two and hid the rest behind "ver los que faltan";
                    // at row height that budget is gone and a charge the list
                    // does not show is a charge nobody answers.
                    ForEach(charges, id: \.id) { charge in
                        BankChargeRow(
                            charge: charge,
                            suggestion: model.bankChargeSuggestions
                                .first { $0.chargeId == charge.id }
                        )
                        .contentShape(Rectangle())
                        .onTapGesture { decidingCharge = charge }
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { decidingCharge = charge }
                        .listRowBackground(Theme.surface)
                        .listRowSeparatorTint(Theme.separator)
                    }
                    // One press for the lot, from TWO up: with a single charge
                    // its own sheet is one tap away and a second way to press
                    // it is noise.
                    if pendingGuesses.count >= 2 {
                        Button {
                            confirmingAll = true
                        } label: {
                            HStack(spacing: 7) {
                                Image(systemName: "checklist")
                                    .font(.system(size: 13, weight: .semibold))
                                Text(l10n.t("bank.confirmAll", pendingGuesses.count))
                                    .appFont(13, .bold)
                            }
                            .foregroundStyle(Theme.accentStrong)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            // Without this the row is tappable only on the
                            // glyph and the words: a Button's label does not
                            // claim the space its Spacer or its alignment
                            // frame occupies. Measured — a press in the middle
                            // of the dismissed row did nothing at all.
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Theme.surface)
                        .listRowSeparatorTint(Theme.separator)
                    }
                    if dismissed > 0 {
                        Button {
                            showingDismissed = true
                        } label: {
                            HStack {
                                Text(l10n.dismissedChargesCount(dismissed))
                                    .appFont(13, .semibold)
                                    .foregroundStyle(Theme.inkSecondary)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Theme.inkTertiary)
                                    .accessibilityHidden(true)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Theme.surface)
                        .listRowSeparatorTint(Theme.separator)
                    }
                }
            } header: {
                bankHeader(count: charges.count)
            }
        }
    }

    private func bankHeader(count: Int) -> some View {
        sectionHeader(
            title: [
                .init(
                    l10n.t("bank.sectionHeader"),
                    color: Theme.infoText, font: AppFont.font(13, .bold)
                ),
                .init(
                    count > 0 ? " · \(count)" : "",
                    color: Theme.inkTertiary, font: AppFont.font(13, .medium)
                ),
            ],
            // The day headers carry their day's total; this carries the bank's,
            // in the currency the bank speaks.
            trailing: count > 0
                ? MoneyFormatter.usd(
                    model.expenseBankCharges.reduce(0) { $0 + $1.usdCents },
                    locale: l10n.locale
                )
                : nil
        )
    }

    private func confirmAll() {
        let guesses = pendingGuesses
        guard !guesses.isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        for guess in guesses {
            model.assignBankCharge(guess.charge, to: guess.expenseId)
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
