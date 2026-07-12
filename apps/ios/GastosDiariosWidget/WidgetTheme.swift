import SwiftUI
import UIKit

// Design tokens duplicated from docs/design/tokens.md — the widget target
// deliberately depends on nothing from the app target.

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

    static func widgetHex(light: String, dark: String, lightAlpha: Double = 1, darkAlpha: Double = 1) -> Color {
        Color(
            light: Color(hex: light, alpha: lightAlpha),
            dark: Color(hex: dark, alpha: darkAlpha)
        )
    }
}

enum WidgetTheme {
    static let bg = Color.widgetHex(light: "#FAF6EF", dark: "#191410")
    static let ink = Color.widgetHex(light: "#241A10", dark: "#F6EEE2")
    static let inkSecondary = Color.widgetHex(light: "#8F8272", dark: "#A2937F")
    static let inkTertiary = Color.widgetHex(light: "#B4A794", dark: "#6E6153")
    /// Progress track (light .08 / dark .09 per design).
    static let track = Color.widgetHex(light: "#241A10", dark: "#F6EEE2", lightAlpha: 0.08, darkAlpha: 0.09)
    static let red = Color(hex: "#E5484D")

    /// Budget-state bar color: green / amber / red per tokens.md.
    static func stateColor(_ state: String) -> Color {
        switch state {
        case "warning": return Color(hex: "#E39A0C")
        case "over": return red
        default: return Color.widgetHex(light: "#2E9E5B", dark: "#40BE74")
        }
    }
}
