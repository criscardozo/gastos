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

// MARK: - Design tokens
//
// The Color.hex(light:dark:) VALUES below are generated from
// design-system/tokens.json — the same file the web's globals.css is generated
// from, which is why the two cannot drift apart. Two of them had, before this:
// the dark warning text sat under the AA contrast floor on web only, and the
// track opacity differed by 0.01. Change a token there and run:
//
//     python3 design-system/emit.py --write

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
    /// The FAMILY, not a named instance.
    ///
    /// Outfit-Variable.ttf is a variable font: its name table says family
    /// "Outfit Thin", postScript "Outfit-Thin", typographic family "Outfit".
    /// iOS registers the typographic family and the default instance — it does
    /// NOT register "Outfit-Regular", "Outfit-SemiBold" or "Outfit-Bold", which
    /// is what this used to ask for. All three came back nil, so `available`
    /// was false and every label in the app fell through to the system rounded
    /// face. The app has never rendered in Outfit.
    ///
    /// Asking for the family and setting the weight with `.weight(_:)` is what
    /// a variable font is for: the weight axis is interpolated rather than
    /// picked from a file that does not exist.
    private static let family = "Outfit"

    private static let available: Bool = UIFont(name: family, size: 12) != nil

    /// Which of Apple's text styles a size grows WITH.
    ///
    /// `relativeTo:` needs one, and the choice decides the growth curve, not
    /// the starting size — at the default Dynamic Type setting it renders the
    /// same number that was measured by hand, so the design does not move.
    ///
    /// `floor` on purpose: it makes a half-point pair (11 and 11.5, 14 and
    /// 14.5) share an anchor. Two labels on the same row growing at different
    /// rates is how a row comes apart at the larger settings.
    /// Internal, not private, so a test can hold the rule below to account:
    /// the anchor must depend only on `floor(size)`, which is what keeps a
    /// half-point pair growing together. A comment says that for the sizes
    /// somebody already wrote; a test says it for the ones they have not.
    static func style(for size: CGFloat) -> Font.TextStyle {
        switch floor(size) {
        case ..<12: return .caption2
        case ..<13: return .caption
        case ..<14: return .footnote
        case ..<16: return .subheadline
        case ..<17: return .callout
        case ..<20: return .body
        case ..<24: return .title2
        case ..<30: return .title
        default: return .largeTitle
        }
    }

    private static func uiStyle(_ style: Font.TextStyle) -> UIFont.TextStyle {
        switch style {
        case .caption2: return .caption2
        case .caption: return .caption1
        case .footnote: return .footnote
        case .subheadline: return .subheadline
        case .callout: return .callout
        case .body: return .body
        case .title2: return .title2
        case .title: return .title1
        default: return .largeTitle
        }
    }

    /// Outfit at the given size/weight, falling back to system rounded.
    ///
    /// Both branches SCALE with Dynamic Type. The fallback used to be a fixed
    /// size, and that is what hid the bug above: with the font silently
    /// missing, turning "Larger Text" to the maximum changed nothing on
    /// screen, which reads exactly like a design that was meant to be fixed.
    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let style = style(for: size)
        guard available else {
            return .system(size: scaled(size), weight: weight, design: .rounded)
        }
        return .custom(family, size: size, relativeTo: style).weight(weight)
    }

    /// `size`, grown by whatever Dynamic Type setting applies.
    ///
    /// `traits` exists for tests, and the reason is worth stating: without it
    /// `scaledValue(for:)` reads the CONTENT SIZE OF THE DEVICE, so a test
    /// asserting "at the default setting this is still 11" passes or fails
    /// depending on what the simulator was left on by the last experiment. It
    /// is a pure-looking function that is really reading the environment —
    /// the same trap as `TimeZone.current` in a date test. Pass `.large` for
    /// "does not grow" and an accessibility size for "does".
    static func scaled(
        _ size: CGFloat,
        compatibleWith traits: UITraitCollection? = nil
    ) -> CGFloat {
        UIFontMetrics(forTextStyle: uiStyle(style(for: size)))
            .scaledValue(for: size, compatibleWith: traits)
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
