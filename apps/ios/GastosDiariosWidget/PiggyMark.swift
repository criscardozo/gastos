import SwiftUI

/// The brand mark: the geometric piggy with a coin dropping in.
///
/// Ported from the web's `PiggyMark` (apps/web/src/components/brand.tsx), which
/// is the design system's own SVG. Every element is a plain shape laid out on
/// the same 96×96 grid the SVG uses, so the two marks stay recognisably the
/// same drawing — `Canvas` would have been closer to the original but WidgetKit
/// cannot render it.
///
/// Lives in the widget target because that target deliberately depends on
/// nothing from the app.
struct PiggyMark: View {
    var size: CGFloat = 24
    /// The pig itself, and the coin.
    var bodyColor: Color
    /// Eye, nostrils and the slot on its back — reads as the accent.
    var detailColor: Color

    private var s: CGFloat { size / 96 }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Legs first, so the body sits over them.
            leg(x: 29)
            leg(x: 55)

            // Ear — two quadratic curves, exactly as in the SVG.
            Path { path in
                path.move(to: pt(54, 33.5))
                path.addQuadCurve(to: pt(67, 24.5), control: pt(58, 21.5))
                path.addQuadCurve(to: pt(64.5, 36), control: pt(71.5, 27.5))
                path.closeSubpath()
            }
            .fill(bodyColor)

            Ellipse()
                .fill(bodyColor)
                .frame(width: 62 * s, height: 50 * s)
                .offset(x: 16 * s, y: 31 * s)

            // Snout.
            RoundedRectangle(cornerRadius: 8.5 * s, style: .continuous)
                .fill(bodyColor)
                .frame(width: 17 * s, height: 20 * s)
                .offset(x: 69 * s, y: 46 * s)

            // Nostrils + eye. Sub-pixel at small sizes, which is fine: they
            // read as texture rather than as features, same as the web mark.
            dot(x: 77.5, y: 53, r: 2.2, color: detailColor)
            dot(x: 77.5, y: 59.5, r: 2.2, color: detailColor)
            dot(x: 60.5, y: 49, r: 3, color: detailColor)

            // The slot on its back, and the coin going in.
            RoundedRectangle(cornerRadius: 2.4 * s, style: .continuous)
                .fill(detailColor)
                .frame(width: 16 * s, height: 4.8 * s)
                .offset(x: 35 * s, y: 31.4 * s)
            dot(x: 43, y: 16.5, r: 8.8, color: bodyColor)
            RoundedRectangle(cornerRadius: 1.8 * s, style: .continuous)
                .fill(detailColor)
                .frame(width: 3.6 * s, height: 9.4 * s)
                .offset(x: 41.2 * s, y: 11.8 * s)
        }
        .frame(width: size, height: size)
    }

    // MARK: Grid helpers — everything is positioned in SVG coordinates.

    private func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: x * s, y: y * s)
    }

    private func leg(x: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 5 * s, style: .continuous)
            .fill(bodyColor)
            .frame(width: 10 * s, height: 14 * s)
            .offset(x: x * s, y: 70 * s)
    }

    private func dot(x: CGFloat, y: CGFloat, r: CGFloat, color: Color) -> some View {
        Circle()
            .fill(color)
            .frame(width: r * 2 * s, height: r * 2 * s)
            .offset(x: (x - r) * s, y: (y - r) * s)
    }
}
