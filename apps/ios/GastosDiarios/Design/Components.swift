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

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                let selected = option.value == selection
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
                    .clipShape(Capsule())
                    .shadow(color: selected ? Color(hex: "#241A10", alpha: 0.12) : .clear, radius: 1.5, y: 1)
                    .contentShape(Capsule())
                    .onTapGesture {
                        guard isEnabled else { return }
                        withAnimation(.easeInOut(duration: 0.15)) { selection = option.value }
                    }
            }
        }
        .padding(3)
        .background(Theme.fill)
        .clipShape(Capsule())
        .opacity(isEnabled ? 1 : 0.5)
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
                    .font(.system(size: 13, weight: .semibold))
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
                    .font(.system(size: 13, weight: .semibold))
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
