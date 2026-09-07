import SwiftUI
import UIKit
import XCTest

/// The typography's two rules, held to account.
///
/// Both exist because of a bug that hid for months: the app asked UIFont for
/// "Outfit-Regular", a name a variable font does not register, so every label
/// fell through to the system face — and the fallback used a FIXED size, so
/// turning Larger Text to the maximum moved nothing and the broken typography
/// looked deliberate. What is under test here is the part that stayed silent.
final class AppFontTests: XCTestCase {
    /// The Dynamic Type setting is passed IN, never read from the machine.
    ///
    /// `UIFontMetrics.scaledValue(for:)` without a trait collection reads the
    /// content size of the DEVICE. A test asserting "at the default setting
    /// this is still 11" would then pass or fail depending on what the
    /// simulator was left on by the last experiment — a pure-looking function
    /// quietly measuring the environment, the same trap as `TimeZone.current`
    /// in a date test. (The Stock session hit exactly this and it cost them a
    /// wrong answer of 29.7 for an 11pt symbol.)
    private func traits(_ category: UIContentSizeCategory) -> UITraitCollection {
        UITraitCollection(preferredContentSizeCategory: category)
    }

    // MARK: The anchor depends only on the whole point

    /// A half-point pair must grow at the same rate.
    ///
    /// 11 and 11.5 sit on the same row; 14 and 14.5 do too. Anchored to
    /// different text styles they grow at different rates, and the row comes
    /// apart at the accessibility sizes — which nobody would notice, because
    /// until recently nothing grew at all.
    func testTheAnchorIgnoresTheHalfPoint() {
        // Every size the design system actually uses, and then some.
        for tenths in 100...480 {
            let size = CGFloat(tenths) / 10
            XCTAssertEqual(
                AppFont.style(for: size),
                AppFont.style(for: size.rounded(.down)),
                "the anchor for \(size) must be the anchor for \(size.rounded(.down))"
            )
        }
    }

    func testThePairsInTheScaleShareAnAnchor() {
        // Named, not derived, so the failure says which row broke.
        XCTAssertEqual(AppFont.style(for: 11), AppFont.style(for: 11.5))
        XCTAssertEqual(AppFont.style(for: 12), AppFont.style(for: 12.5))
        XCTAssertEqual(AppFont.style(for: 13), AppFont.style(for: 13.5))
        XCTAssertEqual(AppFont.style(for: 14), AppFont.style(for: 14.5))
    }

    func testBiggerSizesAnchorToBiggerStyles() {
        // Not a tautology: the mapping is a switch, and a switch is exactly
        // where somebody adds a case in the wrong order.
        let order: [Font.TextStyle] = [
            .caption2, .caption, .footnote, .subheadline, .callout, .body,
            .title2, .title, .largeTitle,
        ]
        let rank = { (style: Font.TextStyle) in order.firstIndex(of: style) ?? -1 }
        var previous = -1
        for size in stride(from: CGFloat(10), through: 46, by: 1) {
            let current = rank(AppFont.style(for: size))
            XCTAssertGreaterThanOrEqual(current, previous, "went backwards at \(size)")
            previous = current
        }
    }

    // MARK: Scaling, measured against a setting we chose

    func testTheDefaultSettingRendersTheDesignedNumber() {
        // Whole points come back untouched, which is the claim that matters:
        // at the default setting the design keeps the sizes measured by hand.
        for size in [CGFloat(11), 12, 13, 14, 15, 16, 22, 34, 44] {
            XCTAssertEqual(
                AppFont.scaled(size, compatibleWith: traits(.large)),
                size,
                accuracy: 0.001,
                "\(size)pt must still be \(size)pt at the default setting"
            )
        }
    }

    /// The half-point sizes are NOT untouched, and by exactly how much — ON
    /// THIS PATH, which is the fallback face's, not the one the app renders.
    ///
    /// `scaledValue` quantises to thirds of a point, so 11.5 comes back 11.666…
    /// The commit that introduced `relativeTo:` claimed it "renders exactly the
    /// same number"; that was wrong, and the first version of this test said the
    /// drift was 1/6 pt — also wrong for the text you actually see, because
    /// `.custom(_:size:relativeTo:)` scales the FONT and that path quantises to
    /// whole points (11.5 → 12). `FontScalingPathTests` measures both and holds
    /// the real figure. What is pinned here is only the number a symbol or the
    /// system-font fallback gets.
    ///
    /// Written as an equality rather than hidden under a tolerance: a fudge
    /// factor big enough to swallow this would also swallow a real regression.
    func testHalfPointSizesLandOnTheNearestThirdOfAPoint() {
        for size in [CGFloat(11.5), 12.5, 13.5, 14.5] {
            XCTAssertEqual(
                AppFont.scaled(size, compatibleWith: traits(.large)),
                (size * 3).rounded(.up) / 3,
                accuracy: 0.001,
                "\(size)pt should land on the third of a point above it"
            )
        }
    }

    func testAnAccessibilitySettingActuallyGrowsIt() {
        // The half that was dead: with `fixedSize` this returned the same
        // number at every setting, which is how a font that was never loaded
        // managed to look intentional.
        for size in [CGFloat(11), 14, 22] {
            let grown = AppFont.scaled(size, compatibleWith: traits(.accessibilityExtraLarge))
            XCTAssertGreaterThan(
                grown, size,
                "\(size)pt must grow when the text size is turned up"
            )
        }
    }

    func testItGrowsMonotonicallyWithTheSetting() {
        let categories: [UIContentSizeCategory] = [
            .small, .medium, .large, .extraLarge, .accessibilityMedium,
            .accessibilityLarge, .accessibilityExtraLarge,
        ]
        var previous: CGFloat = 0
        for category in categories {
            let scaled = AppFont.scaled(14, compatibleWith: traits(category))
            XCTAssertGreaterThanOrEqual(scaled, previous, "shrank at \(category.rawValue)")
            previous = scaled
        }
    }
}
