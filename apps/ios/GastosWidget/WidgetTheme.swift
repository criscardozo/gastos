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
    static let inkSecondary = Color.widgetHex(light: "#60574D", dark: "#B2A695")
    static let inkTertiary = Color.widgetHex(light: "#766753", dark: "#988876")
    /// Progress track (light .08 / dark .09 per design).
    static let track = Color.widgetHex(light: "#241A10", dark: "#F6EEE2", lightAlpha: 0.08, darkAlpha: 0.08)
    static let red = Color(hex: "#E5484D")
    /// Brand coral and the cream that sits on it (the mark's two colours).
    static let accent = Color(hex: "#FF5C39")
    static let cream = Color(hex: "#FAF6EF")

    /// Budget-state bar color: green / amber / red per tokens.md.
    static func stateColor(_ state: String) -> Color {
        switch state {
        case "warning": return Color(hex: "#E39A0C")
        case "over": return red
        default: return Color.widgetHex(light: "#2E9E5B", dark: "#40BE74")
        }
    }
}

/// The widget's card: the app's paper, with a whisper of the budget state
/// bleeding in from the corner — green while there is room, amber when it is
/// tight, red once it is gone.
///
/// A view rather than a method so it can be rendered outside a widget context
/// too: `containerBackground` only paints inside a real widget, which would
/// otherwise make the card impossible to look at before shipping it.
struct WidgetBackground: View {
    /// nil → no snapshot yet, so no state to hint at.
    var state: String?

    var body: some View {
        ZStack {
            WidgetTheme.bg
            if let state {
                RadialGradient(
                    colors: [
                        WidgetTheme.stateColor(state).opacity(0.22),
                        WidgetTheme.stateColor(state).opacity(0),
                    ],
                    center: .topTrailing,
                    startRadius: 0,
                    endRadius: 150
                )
            }
        }
    }
}
