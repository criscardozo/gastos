import SwiftUI

// MARK: - Shared design-system components

/// Section label: 11pt/700, uppercase, letter-spacing .07em, tertiary color.
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .appFont(11, .bold)
            .kerning(11 * 0.07)
            .foregroundStyle(Theme.inkTertiary)
    }
}

/// Card container: surface bg, radius 20, 1px hairline, no shadow.
struct Card<Content: View>: View {
    var radius: CGFloat = 20
    var padding: EdgeInsets = EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )
    }
}

/// Member avatar: colored circle with white bold initial.
struct MemberAvatar: View {
    let profile: MemberProfile?
    var size: CGFloat = 26

    var body: some View {
        let color = profile.map { Theme.avatarColor(hex: $0.color) } ?? Theme.inkTertiary
        let initial = profile?.displayName.first.map(String.init)?.uppercased() ?? "?"
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .overlay(
                Text(initial)
                    .appFont(size * 0.46, .bold)
                    .foregroundStyle(.white)
            )
    }
}

/// Budget state pill ("Van bien" / "Queda poco" / "Se pasaron").
struct StatePill: View {
    let state: BudgetState
    let label: String

    var body: some View {
        Text(label)
            .appFont(12, .bold)
            .foregroundStyle(Theme.stateTextColor(state))
            .padding(.horizontal, 11)
            .padding(.vertical, 5)
            .background(Theme.statePillBg(state))
            .clipShape(Capsule())
    }
}

/// Budget progress bar; fill clamped at 100%, track tinted red when over.
struct BudgetBar: View {
    let state: BudgetState
    let fraction: Double  // spent / budget
    var height: CGFloat = 12

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(state == .over ? Theme.redTrack : Theme.track)
                Capsule()
                    .fill(Theme.stateBarColor(state))
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: height)
        .animation(.easeInOut(duration: 0.4), value: fraction)
    }
}

/// Thin single-color mini bar (category breakdown / member split rows).
struct MiniBar: View {
    let color: Color
    let fraction: Double
    var height: CGFloat = 5

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.separator)
                Capsule()
                    .fill(color)
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: height)
    }
}

/// Pill-shaped segmented control matching the design (fill track, white
/// selected pill with subtle shadow).
struct SegmentedPill<T: Hashable>: View {
    let options: [(value: T, label: String)]
    @Binding var selection: T
    var isEnabled: Bool = true

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // Side by side normally, stacked once the text is big.
        //
        // Every caller used to pin this with `.fixedSize()` so the options
        // could not squash each other. At an accessibility size that is a
        // demand for more width than the phone has, and a vertical ScrollView
        // does not clip it — it lays the whole page out wider, so Ajustes came
        // out with its title cut on BOTH sides and the settings unreadable.
        // Stacking is what removes the demand; the callers no longer fix the
        // size at all.
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 3))
            : AnyLayout(HStackLayout(spacing: 0))
        // A capsule around a stacked column reads as one long lozenge, so the
        // shape follows the layout.
        let shape: AnyShape = typeSize.isAccessibilitySize
            ? AnyShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            : AnyShape(Capsule())

        layout {
            ForEach(options, id: \.value) { option in
                let selected = option.value == selection
                // A Button, not a tap gesture on a Text.
                //
                // `onTapGesture` on a shape is INVISIBLE to VoiceOver: there is
                // nothing to focus and nothing to activate, so a control that
                // works perfectly by touch simply does not exist for anyone
                // navigating by voice. A Button is what makes it exist, and
                // `.isSelected` is what says which one is on.
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { selection = option.value }
                } label: {
                    Text(option.label)
                        .appFont(12.5, selected ? .bold : .semibold)
                        .foregroundStyle(selected ? Theme.ink : Theme.inkSecondary)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 12)
                        .frame(maxWidth: .infinity)
                        .background(
                            selected
                                ? AnyShapeStyle(Theme.surface)
                                : AnyShapeStyle(Color.clear)
                        )
                        .clipShape(shape)
                        .shadow(color: selected ? Color(hex: "#241A10", alpha: 0.12) : .clear, radius: 1.5, y: 1)
                        .contentShape(shape)
                }
                .buttonStyle(.plain)
                .disabled(!isEnabled)
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(3)
        .background(Theme.fill)
        .clipShape(shape)
        .opacity(isEnabled ? 1 : 0.5)
    }
}

/// A settings-style row: label on the left, control on the right — until the
/// text is big enough that the two cannot share a line.
///
/// At an accessibility size the control drops below its label and takes the
/// full width. Without this, a label and a control on one line either squash
/// each other into mid-word breaks ("Períod" over "o") or, if the control
/// refuses to squash, push the whole page wider than the screen.
struct AdaptiveRow<Content: View>: View {
    var spacing: CGFloat = 11
    @ViewBuilder var content: Content

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
            : AnyLayout(HStackLayout(spacing: spacing))
        layout { content }
    }
}

/// The `Spacer()` that pushes a row's control to the right — and does nothing,
/// rather than adding a second gap, once `AdaptiveRow` has become a column.
///
/// Top-level rather than nested in `AdaptiveRow` because that one is generic
/// over its content, and `AdaptiveRow.Gap()` cannot infer a `Content` it has
/// no use for.
struct AdaptiveGap: View {
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
    }
}

/// Category icon circle: bg = category color at 14/16%, icon in category
/// color; selected = 2.5pt ink ring.
struct CategoryCircle: View {
    let categoryId: String
    let category: Category
    var size: CGFloat = 50
    var selected: Bool = false

    var body: some View {
        Circle()
            .fill(Theme.categoryCircleBg(id: categoryId, lightHex: category.color))
            .frame(width: size, height: size)
            .overlay(
                Image(systemName: SeedCategories.sfSymbol(forMaterialIcon: category.icon))
                    .font(.system(size: size * 0.42, weight: .medium))
                    .foregroundStyle(Theme.categoryColor(id: categoryId, lightHex: category.color))
                    // Decorative. The category's NAME is beside it as text
                    // everywhere this appears, and without this VoiceOver reads
                    // the raw symbol: the runtime tree had two buttons called
                    // "doc.plaintext.fill".
                    .accessibilityHidden(true)
            )
            .overlay(
                Circle().strokeBorder(selected ? Theme.ink : .clear, lineWidth: 2.5)
            )
    }
}

/// Primary coral CTA: 58pt tall, full radius, coral shadow.
struct PrimaryCTA: View {
    let title: String
    var icon: String? = "checkmark"
    var height: CGFloat = 58
    var enabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .bold))
                }
                Text(title)
                    .appFont(17, .bold)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(Theme.accent)
            .clipShape(Capsule())
            .shadow(color: Color(hex: "#FF5C39", alpha: 0.35), radius: 10, y: 8)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }
}

/// Period navigator pill: ‹ 1 – 14 de julio ›
struct PeriodNavigator: View {
    let label: String
    let canGoBack: Bool
    let canGoForward: Bool
    let onBack: () -> Void
    let onForward: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    // appFont, not a fixed system size: a symbol beside text
                    // that grows and does not grow with it becomes a smaller
                    // and smaller target exactly for the person who turned the
                    // text up.
                    .appFont(13, .semibold)
                    .foregroundStyle(canGoBack ? Theme.inkSecondary : Theme.inkTertiary.opacity(0.5))
                    .padding(4)
            }
            .disabled(!canGoBack)
            Text(label)
                .appFont(13, .semibold)
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 4)
            Button(action: onForward) {
                Image(systemName: "chevron.right")
                    .appFont(13, .semibold)
                    .foregroundStyle(canGoForward ? Theme.inkSecondary : Theme.inkTertiary.opacity(0.5))
                    .padding(4)
            }
            .disabled(!canGoForward)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Theme.surface)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Theme.borderPill, lineWidth: 1))
    }
}

/// A USD figure over its AUD one.
///
/// USD leads on the two screens that came from the web's card side, because
/// that is the currency the card bills in. It is NOT a conversion — the app
/// converts nothing in the ledger — so when there is no USD figure at all this
/// shows an em dash rather than "US$ 0,00", which would read as "costs nothing".
struct UsdOverAud: View {
    let usdCents: Int
    let audCents: Int
    /// False when there is no USD figure for this thing at all.
    let hasUsd: Bool
    let locale: Locale
    /// Headline size, for the two figures a screen leads with.
    var big: Bool = false

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(
            alignment: typeSize.isAccessibilitySize ? .leading : .trailing,
            spacing: typeSize.isAccessibilitySize ? 8 : 1
        ) {
            figure(
                MoneyFormatter.usd(usdCents, locale: locale),
                shown: hasUsd,
                code: "USD",
                size: big ? 21 : 14,
                weight: .bold,
                colour: Theme.ink,
                floor: 0.55
            )
            figure(
                MoneyFormatter.aud(audCents, locale: locale),
                shown: true,
                code: "AUD",
                size: big ? 12.5 : 12,
                weight: .semibold,
                colour: Theme.inkTertiary,
                floor: 0.6
            )
        }
    }

    /// One figure and its currency tag: beside each other, or the tag ABOVE.
    ///
    /// Two things go wrong when the text is big. The tag is a fixed three
    /// letters, so beside the figure it is the FIGURE that gets squeezed —
    /// "US$ 71,49" was rendering as a bare "…", and a card whose whole job is
    /// one number showed no number. And stacked with the tag underneath, the
    /// column reads "USD / $ 71,49 / AUD": every tag looks like it labels the
    /// figure below it, so the AUD total reads as US dollars. Tag first fixes
    /// both — label, then value, which is the order the rest of the app uses.
    @ViewBuilder
    private func figure(
        _ text: String,
        shown: Bool,
        code: String,
        size: CGFloat,
        weight: Font.Weight,
        colour: Color,
        floor: CGFloat
    ) -> some View {
        let amount = Text(shown ? text : "—")
            .appFont(size, weight)
            .foregroundStyle(colour)
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 1) {
                CurrencyTag(code: code)
                // Free to wrap now that it has the full width to itself.
                amount.fixedSize(horizontal: false, vertical: true)
            }
        } else {
            HStack(spacing: 5) {
                amount
                    .lineLimit(1)
                    .minimumScaleFactor(floor)
                CurrencyTag(code: code)
            }
        }
    }
}

/// "🇦🇺 AUD" — the flag as the eye-catching part, the code as the part that is
/// still readable when a platform has no flag glyphs.
struct CurrencyTag: View {
    let code: String

    private static let flags = ["AUD": "🇦🇺", "USD": "🇺🇸", "ARS": "🇦🇷"]

    var body: some View {
        HStack(spacing: 2) {
            if let flag = Self.flags[code] {
                // Scaled, not a fixed 10pt: a flag that stays the same size
                // beside a code three times bigger reads as a stray glyph.
                Text(flag).appFont(10)
            }
            Text(code)
                .appFont(9.5, .bold)
                .kerning(9.5 * 0.04)
                .foregroundStyle(Theme.inkTertiary)
        }
        // A currency code is three letters and must never break: at an
        // accessibility size "USD" was coming out as "US" over "D", which
        // reads as a different currency rather than as a wrapped word. Safe to
        // pin because the tag is three characters wide, not a phrase.
        .lineLimit(1)
        .fixedSize(horizontal: true, vertical: false)
    }
}
