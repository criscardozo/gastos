import SwiftUI

// MARK: - Amount input model (custom keypad state)

enum KeypadKey: Hashable {
    case digit(Int)
    case separator
    case backspace
}

/// Amount being typed on the custom keypad. Canonical storage uses "," as the
/// decimal separator; display swaps it for the locale's one.
struct AmountInput: Equatable {
    private(set) var text: String = ""

    var isEmpty: Bool { text.isEmpty }

    var cents: Int {
        guard !text.isEmpty else { return 0 }
        let parts = text.split(separator: ",", omittingEmptySubsequences: false)
        let whole = Int(parts[0]) ?? 0
        var cents = whole * 100
        if parts.count > 1 {
            let decimals = String(parts[1].prefix(2))
            let padded = decimals.padding(toLength: 2, withPad: "0", startingAt: 0)
            cents += Int(padded) ?? 0
        }
        return cents
    }

    /// "12,50" / "12.50" depending on locale; "0" when empty.
    func display(separator: String) -> String {
        let value = text.isEmpty ? "0" : text
        return value.replacingOccurrences(of: ",", with: separator)
    }

    /// Normalizes free-typed text from a native decimal-pad `TextField` into
    /// the canonical `self.text`. The locale separator (and a stray ".") map
    /// to ",", everything that isn't a digit or separator is stripped, and the
    /// same caps `tap` enforces apply: at most 7 integer digits and 2 decimals.
    mutating func setDisplay(_ typed: String, separator: String) {
        // Map the locale separator (and a raw ".") to the canonical comma.
        var normalized = typed.replacingOccurrences(of: separator, with: ",")
        normalized = normalized.replacingOccurrences(of: ".", with: ",")
        // Keep only digits and commas.
        normalized = String(normalized.filter { $0.isNumber || $0 == "," })
        // Split on the FIRST separator; anything after is decimals.
        let hasSeparator = normalized.contains(",")
        let parts = normalized.split(separator: ",", omittingEmptySubsequences: false)
        // Integer part: cap at 7 digits, strip leading zeros (keep a lone "0").
        var whole = String((parts.first ?? "").prefix(7))
        while whole.count > 1 && whole.hasPrefix("0") { whole.removeFirst() }
        if parts.count > 1 {
            // Decimals: cap at 2.
            let decimals = String(parts[1].prefix(2))
            text = whole + "," + decimals
        } else if hasSeparator {
            // Trailing separator with no decimals yet ("12,").
            text = whole + ","
        } else {
            text = whole
        }
    }

    mutating func tap(_ key: KeypadKey) {
        switch key {
        case .digit(let digit):
            if let commaIndex = text.firstIndex(of: ",") {
                // Cap at 2 decimals.
                guard text.distance(from: commaIndex, to: text.endIndex) <= 2 else { return }
                text.append(String(digit))
            } else {
                guard text.count < 7 else { return }
                if text == "0" { text = "" }
                text.append(String(digit))
            }
        case .separator:
            guard !text.contains(",") else { return }
            text = text.isEmpty ? "0," : text + ","
        case .backspace:
            guard !text.isEmpty else { return }
            text.removeLast()
        }
    }

    static func fromCents(_ cents: Int) -> AmountInput {
        var input = AmountInput()
        if cents % 100 == 0 {
            input.text = String(cents / 100)
        } else {
            input.text = String(format: "%d,%02d", cents / 100, cents % 100)
        }
        return input
    }
}

// MARK: - Keypad

/// Custom 3×4 keypad: 1-9, decimal separator, 0, backspace. White rounded-15
/// keys with a subtle shadow; separator/backspace keys are flat.
struct KeypadView: View {
    let separatorLabel: String
    let onTap: (KeypadKey) -> Void

    private let rows: [[KeypadKey]] = [
        [.digit(1), .digit(2), .digit(3)],
        [.digit(4), .digit(5), .digit(6)],
        [.digit(7), .digit(8), .digit(9)],
        [.separator, .digit(0), .backspace],
    ]

    var body: some View {
        Grid(horizontalSpacing: 8, verticalSpacing: 8) {
            ForEach(0..<4) { row in
                GridRow {
                    ForEach(rows[row], id: \.self) { key in
                        keyView(key)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func keyView(_ key: KeypadKey) -> some View {
        let filled: Bool = {
            if case .digit = key { return true }
            return false
        }()
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onTap(key)
        } label: {
            Group {
                switch key {
                case .digit(let digit):
                    Text(String(digit)).appFont(23, .semibold)
                case .separator:
                    Text(separatorLabel).appFont(23, .semibold)
                case .backspace:
                    Image(systemName: "delete.left")
                        .font(.system(size: 21, weight: .medium))
                }
            }
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                filled
                    ? AnyShapeStyle(Theme.surface)
                    : AnyShapeStyle(Color.clear)
            )
            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
            .shadow(color: filled ? Color(hex: "#241A10", alpha: 0.06) : .clear, radius: 1, y: 1)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Expense form (quick entry layout 1a; reused by the edit sheet)

struct ExpenseFormView: View {
    @Environment(AppModel.self) private var model

    enum Mode {
        case create
        case edit(ExpenseItem)
    }

    let mode: Mode
    var onDone: (() -> Void)?

    /// Which input owns the native keyboard. The amount field auto-focuses on
    /// open so the decimal pad rises immediately; the note field takes over
    /// when tapped (and swaps the keyboard toolbar to note suggestions).
    private enum Field: Hashable { case amount, note }

    @State private var amount = BudgetEntryAmount()
    @State private var selectedCategoryId: String?
    @State private var note = ""
    @State private var pickedDate: CalendarDate?
    @State private var showDatePicker = false
    @FocusState private var focus: Field?

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    private var effectiveDate: CalendarDate { pickedDate ?? model.today }

    private var canSave: Bool { amount.audCents > 0 && selectedCategoryId != nil }

    // MARK: Suggestions (derived from in-memory expenses only)

    /// Recent-amount chips for the selected category — only while the amount is
    /// still empty (they are quick-fills, not a live filter).
    private var recentAmounts: [Int] {
        guard !isEditing, amount.input.isEmpty else { return [] }
        return Suggestions.recentAmounts(
            from: model.suggestionExpenses,
            categoryId: selectedCategoryId,
            limit: 3
        )
    }

    /// Note autocomplete suggestions, filtered by what's typed so far. Drops a
    /// suggestion identical to the current note (nothing to fill).
    private var noteSuggestions: [String] {
        guard !isEditing else { return [] }
        let typed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return Suggestions.topNotes(
            from: model.suggestionExpenses,
            categoryId: selectedCategoryId,
            matching: note,
            limit: 4
        )
        .filter { $0.caseInsensitiveCompare(typed) != .orderedSame }
    }

    var body: some View {
        // NavigationStack (bar hidden) hosts the keyboard toolbar accessory —
        // `.keyboard` placement needs a navigation container to attach to.
        NavigationStack {
            VStack(spacing: 0) {
                header
                if !isEditing, SigningExpiryService.isExpiringSoon() {
                    signingExpiryBanner
                }
                heroAmount
                categoryRow
                if !recentAmounts.isEmpty {
                    amountChips
                }
                noteField
                // Bottom CTA for when the keyboard is dismissed; while a field
                // is focused the keyboard toolbar carries the "Guardar" action.
                PrimaryCTA(
                    title: l10n.t(isEditing ? "common.save" : "entry.save"),
                    enabled: canSave
                ) {
                    save()
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, isEditing ? 18 : 6)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // Tap any empty area to dismiss the keyboard (brings the tab bar
            // back). A reliable, discoverable escape that doesn't depend on the
            // keyboard accessory toolbar rendering. Interactive controls sit in
            // front and receive their taps first.
            .background(
                Theme.bg
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { focus = nil }
            )
            .toolbar(.hidden, for: .navigationBar)
            // Hide the main tab bar while a field is focused: with the keyboard
            // up it would otherwise bleed through the keyboard's translucent
            // bottom strip. Tapping any empty area (above) dismisses the
            // keyboard and brings it back. (No-op in the edit sheet, which has
            // no tab bar.)
            .toolbar(focus == nil ? .visible : .hidden, for: .tabBar)
            .toolbar {
                // Note autocomplete only. There is deliberately NO accessory
                // bar for the amount field: saving is covered by the always
                // visible bottom CTA and dismissing by the background tap.
                if focus == .note, !noteSuggestions.isEmpty {
                    ToolbarItemGroup(placement: .keyboard) {
                        noteSuggestionBar
                    }
                }
            }
        }
        .sheet(isPresented: $showDatePicker) {
            datePickerSheet
        }
        .onAppear {
            load()
            // Raise the native decimal pad on the amount field. A short hop
            // past the current run loop makes the focus reliably bring up the
            // keyboard once the field is in the hierarchy.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                focus = .amount
            }
        }
    }

    // MARK: Pieces

    /// Horizontal recent-amount quick-fill pills, shown under the category row.
    private var amountChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(recentAmounts, id: \.self) { cents in
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        withAnimation(.snappy(duration: 0.15)) {
                            amount.setAUDCents(cents)
                        }
                    } label: {
                        Text(MoneyFormatter.audCompact(cents, locale: l10n.locale))
                            .appFont(13, .semibold)
                            .monospacedDigit()
                            .foregroundStyle(Theme.ink)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Theme.fill)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
        .padding(.horizontal, -20)
        .padding(.bottom, 12)
    }

    /// Note autocomplete pills, hosted in the keyboard toolbar so they sit just
    /// above the system keyboard while the note field is focused.
    private var noteSuggestionBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(noteSuggestions, id: \.self) { suggestion in
                    Button {
                        note = suggestion
                        focus = nil
                    } label: {
                        Text(suggestion)
                            .appFont(14, .semibold)
                            .foregroundStyle(Theme.accentStrong)
                            .lineLimit(1)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(Theme.accentSoft)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var header: some View {
        HStack {
            Text(l10n.t(isEditing ? "entry.edit.title" : "entry.title"))
                .appFont(18, .bold)
                .foregroundStyle(Theme.ink)
            Spacer()
            if isEditing {
                Button(l10n.t("common.cancel")) { onDone?() }
                    .appFont(14, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
            } else {
                remainingPill
            }
        }
        .padding(.bottom, 4)
    }

    /// "Quedan $287,60" pill colored by budget state, sized to content so it
    /// sits cleanly beside the title.
    private var remainingPill: some View {
        let state = model.currentBudgetState
        let remaining = model.currentRemainingCents
        return HStack(spacing: 7) {
            Circle()
                .fill(Theme.stateBarColor(state))
                .frame(width: 7, height: 7)
            Text(l10n.t("remaining.pill", MoneyFormatter.aud(remaining, locale: l10n.locale)))
                .appFont(13, .semibold)
                .monospacedDigit()
                .foregroundStyle(Theme.stateTextColor(state))
                .lineLimit(1)
        }
        .fixedSize()
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Theme.statePillBg(state))
        .clipShape(Capsule())
    }

    /// Permanent warning on the home screen for the last two days of the
    /// free-account signature. Not dismissible on purpose: once the build
    /// expires the app stops launching, so this is the last chance to notice.
    /// Hidden entirely when there is no profile (Simulator) or more than two
    /// days are left.
    @ViewBuilder
    private var signingExpiryBanner: some View {
        let days = SigningExpiryService.daysRemaining() ?? 0
        let expired = days < 0
        let urgent = days <= 1
        HStack(spacing: 9) {
            Image(systemName: expired ? "exclamationmark.octagon.fill" : "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(urgent ? Theme.redText : Theme.accentStrong)
            VStack(alignment: .leading, spacing: 1) {
                Text(expiryHeadline(days: days, expired: expired))
                    .appFont(13, .bold)
                    .foregroundStyle(urgent ? Theme.redText : Theme.accentStrong)
                Text(l10n.t("signing.banner.body"))
                    .appFont(11.5)
                    .foregroundStyle(Theme.inkSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .background(urgent ? Theme.redBg : Theme.accentSoft)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.bottom, 10)
    }

    private func expiryHeadline(days: Int, expired: Bool) -> String {
        if expired { return l10n.t("signing.banner.expired") }
        if days == 0 { return l10n.t("signing.banner.today") }
        if days == 1 { return l10n.t("signing.banner.tomorrow") }
        return l10n.t("signing.banner.days", days)
    }

    private var heroAmount: some View {
        VStack(spacing: 12) {
            // Editable hero amount driven by the native decimal pad. Bound
            // through the canonical `AmountInput`, so cents/audCents and the
            // recent-amount chips all keep working.
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("$")
                    .appFont(30, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
                TextField("0", text: amountText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.center)
                    .fixedSize()
                    .amountStyle(66, .bold)
                    .kerning(-0.03 * 66)
                    .foregroundStyle(Theme.ink)
                    .focused($focus, equals: .amount)
            }
            datePill
        }
        .frame(maxHeight: .infinity)
        .frame(minHeight: 90)
    }

    /// Bridges the native `TextField` to the canonical `AmountInput`: reads the
    /// locale-formatted display, writes back through `setDisplay` (which caps
    /// digits/decimals), so `cents`, `audCents` and the chips stay in sync.
    private var amountText: Binding<String> {
        Binding(
            get: { amount.input.display(separator: separator) },
            set: { amount.input.setDisplay($0, separator: separator) }
        )
    }

    private var datePill: some View {
        Button {
            showDatePicker = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "calendar")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.inkSecondary)
                Text(dateLabel)
                    .appFont(13, .semibold)
                    .foregroundStyle(Theme.ink)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.inkTertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(Theme.surface)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Theme.borderPill, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var dateLabel: String {
        let timeZone = model.householdTimeZone
        if effectiveDate == model.today {
            return l10n.t("entry.today", l10n.shortWeekday(effectiveDate, timeZone: timeZone))
        }
        return l10n.dayHeader(effectiveDate, timeZone: timeZone)
    }

    private var categoryRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(model.household?.sortedCategories ?? [], id: \.id) { entry in
                    let selected = entry.id == selectedCategoryId
                    VStack(spacing: 6) {
                        CategoryCircle(
                            categoryId: entry.id,
                            category: entry.category,
                            size: 50,
                            selected: selected
                        )
                        Text(l10n.categoryName(entry.category))
                            .appFont(11.5, .semibold)
                            .foregroundStyle(selected ? Theme.ink : Theme.inkSecondary)
                            .lineLimit(1)
                    }
                    .frame(minWidth: 62)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation(.snappy(duration: 0.15)) {
                            selectedCategoryId = entry.id
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 2)
        }
        .padding(.horizontal, -20)
        .padding(.bottom, 14)
    }

    private var noteField: some View {
        HStack(spacing: 8) {
            Image(systemName: "pencil.line")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.inkTertiary)
            TextField(l10n.t("entry.note.placeholder"), text: $note)
                .appFont(15)
                .foregroundStyle(Theme.ink)
                .focused($focus, equals: .note)
                .submitLabel(.done)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
        .padding(.bottom, 14)
    }

    private var datePickerSheet: some View {
        DatePickerSheet(
            timeZone: model.householdTimeZone,
            locale: l10n.locale,
            initial: effectiveDate,
            title: l10n.t("entry.date.title"),
            doneLabel: l10n.t("common.done")
        ) { picked in
            pickedDate = picked
        }
    }

    // MARK: Actions

    private func load() {
        guard case .edit(let item) = mode else {
            if selectedCategoryId == nil {
                selectedCategoryId = model.household?.sortedCategories.first?.id
            }
            return
        }
        amount = .fromAUDCents(item.expense.amountCents)
        selectedCategoryId = item.expense.categoryId
        note = item.expense.note
        pickedDate = CalendarDate(item.expense.date)
    }

    private func save() {
        guard let categoryId = selectedCategoryId, amount.audCents > 0 else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        switch mode {
        case .create:
            model.saveExpense(
                amountCents: amount.audCents,
                categoryId: categoryId,
                note: note.trimmingCharacters(in: .whitespacesAndNewlines),
                date: pickedDate
            )
            // Reset for the next quick entry.
            amount = BudgetEntryAmount()
            note = ""
            pickedDate = nil
            // Keep the decimal pad up on the amount field for the next entry.
            focus = .amount
        case .edit(let item):
            if let id = item.expense.id, let date = pickedDate ?? CalendarDate(item.expense.date) {
                model.updateExpense(
                    id: id,
                    amountCents: amount.audCents,
                    categoryId: categoryId,
                    note: note.trimmingCharacters(in: .whitespacesAndNewlines),
                    date: date,
                    // A new amount invalidates the bank's USD for the old one.
                    clearVerification: item.expense.isVerified
                        && item.expense.amountCents != amount.audCents
                )
            }
            onDone?()
        }
    }
}

// MARK: - Date picker sheet

struct DatePickerSheet: View {
    let timeZone: TimeZone
    let locale: Locale
    let initial: CalendarDate
    let title: String
    let doneLabel: String
    let onPick: (CalendarDate) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selection: Date = Date()

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text(title)
                    .appFont(17, .bold)
                    .foregroundStyle(Theme.ink)
                Spacer()
                Button(doneLabel) {
                    onPick(PeriodLogic.todayInTimezone(selection, timeZone))
                    dismiss()
                }
                .appFont(15, .bold)
                .foregroundStyle(Theme.accentStrong)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            DatePicker("", selection: $selection, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .environment(\.locale, locale)
                .environment(\.timeZone, timeZone)
                .tint(Theme.accent)
                .padding(.horizontal, 12)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .background(Theme.bg)
        .onAppear {
            let parts = initial.raw.split(separator: "-")
            selection = calendar.date(from: DateComponents(
                year: Int(parts[0]), month: Int(parts[1]), day: Int(parts[2]), hour: 12
            )) ?? Date()
        }
    }
}

// MARK: - Quick entry tab

struct QuickEntryView: View {
    var body: some View {
        ExpenseFormView(mode: .create)
    }
}
