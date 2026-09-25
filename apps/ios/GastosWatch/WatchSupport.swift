import SwiftUI

// Small self-contained support layer for the watch target. It shares NO code
// with the phone/app target (deliberately minimal, no Firebase) — design
// tokens are duplicated from docs/design/tokens.md, and the seed categories are
// decoded from the bundled shared/categories.json.

// MARK: - Color

extension Color {
    /// "#RRGGBB" (leading '#' optional), with optional alpha override.
    init(hex: String, alpha: Double = 1) {
        var value: UInt64 = 0
        let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        Scanner(string: cleaned).scanHexInt64(&value)
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: alpha
        )
    }
}

// MARK: - Theme (watchOS renders dark; dark-variant tokens only)

enum WatchTheme {
    static let bg = Color(hex: "#191410")
    static let surface = Color(hex: "#242019")
    static let ink = Color(hex: "#F6EEE2")
    static let inkSecondary = Color(hex: "#B2A695")
    static let inkTertiary = Color(hex: "#988876")
    static let accent = Color(hex: "#FF5C39")
    static let green = Color(hex: "#40BE74")
    static let amber = Color(hex: "#E39A0C")
    static let red = Color(hex: "#E5484D")

    static func stateColor(_ state: String) -> Color {
        switch state {
        case "warning": return amber
        case "over": return red
        default: return green
        }
    }
}

// MARK: - Seed categories (bundled shared/categories.json)

struct WatchCategory: Identifiable, Decodable {
    struct Icon: Decodable { let sfSymbol: String }
    struct SeedColor: Decodable { let dark: String }
    let id: String
    let key: String
    let icon: Icon
    let color: SeedColor
    let sortOrder: Int
}

enum WatchCategories {
    private struct File: Decodable { let categories: [WatchCategory] }

    static let all: [WatchCategory] = {
        guard let url = Bundle.main.url(forResource: "categories", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data)
        else { return [] }
        return file.categories.sorted { $0.sortOrder < $1.sortOrder }
    }()
}

// MARK: - Budget snapshot pushed from the phone

struct WatchBudget: Equatable {
    let remainingCents: Int
    let budgetCents: Int
    let state: String
    let currency: String

    /// "$287,60" via the watch's own locale; bare "$" like the design.
    var formattedRemaining: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = .autoupdatingCurrent
        formatter.currencySymbol = "$"
        let decimals = remainingCents % 100 == 0 ? 0 : 2
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        let amount = NSDecimalNumber(value: remainingCents).dividing(by: 100)
        return formatter.string(from: amount) ?? "$0"
    }

}
