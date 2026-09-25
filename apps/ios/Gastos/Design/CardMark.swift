import SwiftUI

/// Which card a charge went on, as a mark rather than a word.
///
/// The web's `CardMark` (components/ui/marks.tsx), drawn the same way: plain
/// geometry — two interlocking circles, a wordmark — not the brands' official
/// artwork. It exists to tell two rows apart at a glance. The rows here had a
/// 62pt column holding "Visa" or "Mastercard" in 10pt grey, the one column in
/// the list nobody could read at a glance.
struct CardMark: View {
    let brand: CardBrand
    /// The mark's width; Mastercard's height follows its 48:30 box.
    var width: CGFloat = 30

    /// `--visa` in globals.css: the wordmark has to stay legible on both
    /// surfaces. design-tokens.test.ts holds the two copies together.
    static let visaBlue = Color.hex(light: "#1434CB", dark: "#7D9DFF")

    var body: some View {
        switch brand {
        case .mastercard:
            Canvas { context, size in
                let unit = size.width / 48
                let left = Path(ellipseIn: CGRect(x: 5 * unit, y: 2 * unit, width: 26 * unit, height: 26 * unit))
                let right = Path(ellipseIn: CGRect(x: 17 * unit, y: 2 * unit, width: 26 * unit, height: 26 * unit))
                context.fill(left, with: .color(Color(hex: "#EB001B")))
                context.fill(right, with: .color(Color(hex: "#F79E1B")))
                // The lens where they overlap, darker, as on the card.
                context.fill(left.intersection(right), with: .color(Color(hex: "#FF5F00")))
            }
            .frame(width: width, height: width * 30 / 48)
            .accessibilityElement()
            .accessibilityLabel(brand.label)
        case .visa:
            Text(verbatim: "VISA")
                .font(.system(size: width * 0.46, weight: .black))
                .italic()
                .kerning(-0.02 * width * 0.46)
                .foregroundStyle(Self.visaBlue)
                .fixedSize()
                .accessibilityLabel(brand.label)
        }
    }
}
