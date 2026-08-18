import SwiftUI
import UIKit

// MARK: - Color helpers

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

    /// Dynamic color that adapts to light/dark mode.
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    }

    static func hex(light: String, dark: String, lightAlpha: Double = 1, darkAlpha: Double = 1) -> Color {
        Color(
            light: Color(hex: light, alpha: lightAlpha),
            dark: Color(hex: dark, alpha: darkAlpha)
        )
    }
}

// MARK: - Design tokens (docs/design/tokens.md — implemented exactly)

enum Theme {
    // Core palette
    static let bg = Color.hex(light: "#FAF6EF", dark: "#191410")
    static let surface = Color.hex(light: "#FFFFFF", dark: "#242019")
    static let ink = Color.hex(light: "#241A10", dark: "#F6EEE2")
    static let inkSecondary = Color.hex(light: "#8F8272", dark: "#A2937F")
    static let inkTertiary = Color.hex(light: "#B4A794", dark: "#6E6153")

    /// Hairlines: cards .08, pills .10.
    static let border = Color.hex(light: "#241A10", dark: "#F6EEE2", lightAlpha: 0.08, darkAlpha: 0.08)
    static let borderPill = Color.hex(light: "#241A10", dark: "#F6EEE2", lightAlpha: 0.10, darkAlpha: 0.10)
    /// Segmented control track, muted badges.
    static let fill = Color.hex(light: "#241A10", dark: "#F6EEE2", lightAlpha: 0.06, darkAlpha: 0.07)
    /// Progress track (light .08 / dark .09 per design).
    static let track = Color.hex(light: "#241A10", dark: "#F6EEE2", lightAlpha: 0.08, darkAlpha: 0.08)
    /// Row separators inside cards (.06).
    static let separator = Color.hex(light: "#241A10", dark: "#F6EEE2", lightAlpha: 0.06, darkAlpha: 0.06)

    // Accent (coral) — unchanged in dark mode.
    static let accent = Color(hex: "#FF5C39")
    static let accentStrong = Color(hex: "#E8492A")
    static let accentSoft = Color(hex: "#FF5C39", alpha: 0.12)

    // Budget states
    static let green = Color.hex(light: "#2E9E5B", dark: "#40BE74")
    static let greenText = Color.hex(light: "#1F7A45", dark: "#6FD79A")
    static let greenBg = Color.hex(light: "#2E9E5B", dark: "#40BE74", lightAlpha: 0.12, darkAlpha: 0.16)
    static let amber = Color(hex: "#E39A0C")
    static let amberText = Color.hex(light: "#B87804", dark: "#E39A0C")
    static let amberBg = Color(hex: "#E39A0C", alpha: 0.15)
    static let red = Color(hex: "#E5484D")
    static let redText = Color(hex: "#E5484D")
    static let redBg = Color(hex: "#E5484D", alpha: 0.11)
    /// Over-budget track tint.
    static let redTrack = Color(hex: "#E5484D", alpha: 0.2)

    // Member avatars (Cristian blue / Natalia pink); dark variants per tokens.
    static let avatarBlue = Color.hex(light: "#2A6FDB", dark: "#4B87E8")
    static let avatarPink = Color.hex(light: "#E0447C", dark: "#EF6D9C")

    /// Avatar color from a stored memberProfiles hex, adapting known light
    /// values to their dark variants.
    static func avatarColor(hex: String) -> Color {
        switch hex.uppercased() {
        case "#2A6FDB": return avatarBlue
        case "#E0447C": return avatarPink
        default: return Color(hex: hex)
        }
    }

    /// Category color adapting to dark mode via the seed table.
    static func categoryColor(id: String, lightHex: String) -> Color {
        Color.hex(light: lightHex, dark: SeedCategories.darkColor(categoryId: id, lightHex: lightHex))
    }

    /// Category icon-circle background: color at 14% (light) / 16% (dark).
    static func categoryCircleBg(id: String, lightHex: String) -> Color {
        Color.hex(
            light: lightHex,
            dark: SeedCategories.darkColor(categoryId: id, lightHex: lightHex),
            lightAlpha: 0.14,
            darkAlpha: 0.16
        )
    }

    // Budget state → colors
    static func stateBarColor(_ state: BudgetState) -> Color {
        switch state {
        case .comfortable: return green
        case .warning: return amber
        case .over: return red
        }
    }

    static func stateTextColor(_ state: BudgetState) -> Color {
        switch state {
        case .comfortable: return greenText
        case .warning: return amberText
        case .over: return redText
        }
    }

    static func statePillBg(_ state: BudgetState) -> Color {
        switch state {
        case .comfortable: return greenBg
        case .warning: return amberBg
        case .over: return redBg
        }
    }
}

// MARK: - Outfit font

enum AppFont {
    private static func name(for weight: Font.Weight) -> String {
        switch weight {
        case .bold, .heavy, .black: return "Outfit-Bold"
        case .semibold, .medium: return "Outfit-SemiBold"
        default: return "Outfit-Regular"
        }
    }

    private static let available: Bool = UIFont(name: "Outfit-Regular", size: 12) != nil

    /// Outfit at the given size/weight, falling back to system rounded.
    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        guard available else {
            return .system(size: size, weight: weight, design: .rounded)
        }
        return .custom(name(for: weight), fixedSize: size)
    }
}

extension View {
    /// Outfit typography shorthand.
    func appFont(_ size: CGFloat, _ weight: Font.Weight = .regular) -> some View {
        font(AppFont.font(size, weight))
    }

    /// Amounts always use tabular numerals.
    func amountStyle(_ size: CGFloat, _ weight: Font.Weight = .bold) -> some View {
        font(AppFont.font(size, weight)).monospacedDigit()
    }
}
