import SwiftUI

/// Glanceable quick expense entry for the watch: budget line (if the phone has
/// pushed one), a Digital Crown-adjustable amount, a scrollable category grid,
/// and a Save button that relays to the phone.
struct WatchEntryView: View {
    @StateObject private var connectivity = WatchConnectivityModel()

    /// Amount in dollars, driven by the Digital Crown (50-cent steps).
    @State private var dollars: Double = 0
    @State private var selectedCategoryId: String?
    @State private var showConfirmation = false
    @FocusState private var crownFocused: Bool

    private let categories = WatchCategories.all
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 3)

    private var amountCents: Int { Int((dollars * 100).rounded()) }
    private var canSave: Bool { amountCents > 0 && selectedCategoryId != nil }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let budget = connectivity.budget {
                    budgetLine(budget)
                }
                amountView
                categoryGrid
                saveButton
            }
            .padding(.horizontal, 2)
            .padding(.bottom, 6)
        }
        .background(WatchTheme.bg.ignoresSafeArea())
        .overlay { if showConfirmation { confirmationOverlay } }
        .onAppear {
            if selectedCategoryId == nil { selectedCategoryId = categories.first?.id }
            crownFocused = true
        }
    }

    // MARK: Pieces

    private func budgetLine(_ budget: WatchBudget) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(WatchTheme.stateColor(budget.state))
                .frame(width: 7, height: 7)
            Text(String(format: String(localized: "watch.remaining"), budget.formattedRemaining))
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(WatchTheme.stateColor(budget.state))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
    }

    private var amountView: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text("$")
                .font(.system(size: 22, weight: .semibold, design: .rounded))
                .foregroundStyle(WatchTheme.inkTertiary)
            Text(formattedAmount)
                .font(.system(size: 42, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(WatchTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .focusable(true)
        .focused($crownFocused)
        .digitalCrownRotation(
            $dollars,
            from: 0,
            through: 9999,
            by: 0.5,
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
    }

    private var categoryGrid: some View {
        LazyVGrid(columns: columns, spacing: 6) {
            ForEach(categories) { category in
                let selected = category.id == selectedCategoryId
                Button {
                    selectedCategoryId = category.id
                } label: {
                    categoryCircle(category, selected: selected)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func categoryCircle(_ category: WatchCategory, selected: Bool) -> some View {
        let color = Color(hex: category.color.dark)
        return VStack(spacing: 3) {
            Circle()
                .fill(color.opacity(0.16))
                .frame(width: 40, height: 40)
                .overlay(
                    Image(systemName: category.icon.sfSymbol)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(color)
                )
                .overlay(
                    Circle().strokeBorder(selected ? WatchTheme.ink : .clear, lineWidth: 2.5)
                )
            Text(categoryName(category))
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(selected ? WatchTheme.ink : WatchTheme.inkSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private var saveButton: some View {
        Button {
            save()
        } label: {
            Text(String(localized: "watch.save"))
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(WatchTheme.accent.opacity(canSave ? 1 : 0.4))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!canSave)
    }

    private var confirmationOverlay: some View {
        VStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(WatchTheme.green)
            Text(String(localized: "watch.saved"))
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(WatchTheme.ink)
            Text(String(localized: "watch.saved.sync"))
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(WatchTheme.inkSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WatchTheme.bg.opacity(0.96))
    }

    // MARK: Helpers

    private var formattedAmount: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = .autoupdatingCurrent
        let decimals = amountCents % 100 == 0 ? 0 : 2
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = 2
        let amount = NSDecimalNumber(value: amountCents).dividing(by: 100)
        return formatter.string(from: amount) ?? "0"
    }

    private func categoryName(_ category: WatchCategory) -> String {
        String(localized: String.LocalizationValue("category.\(category.key)"))
    }

    private var todayYMD: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private func save() {
        guard canSave, let categoryId = selectedCategoryId else { return }
        connectivity.sendExpense(amountCents: amountCents, categoryId: categoryId, dateYMD: todayYMD)
        withAnimation { showConfirmation = true }
        // Reset for the next entry.
        dollars = 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
            withAnimation { showConfirmation = false }
        }
    }
}
