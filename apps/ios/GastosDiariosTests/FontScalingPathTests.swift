import CoreText
import SwiftUI
import UIKit
import XCTest

/// The path the app's TEXT takes, as opposed to the one its numbers take.
///
/// `AppFontTests` measures `AppFont.scaled`, which is `UIFontMetrics
/// .scaledValue(for:)`: a bare number, used by the fallback face and by
/// anything sizing a symbol. But a label styled with `.custom(_:size:
/// relativeTo:)` never goes through it — SwiftUI scales the FONT, which is
/// `UIFontMetrics.scaledFont(for:)`, and the two do not agree. This file
/// pins the difference so neither can drift without a test saying so.
final class FontScalingPathTests: XCTestCase {
    override class func setUp() {
        super.setUp()
        registerTheFont()
    }

    /// A test bundle has no `UIAppFonts`, so the face has to be registered by
    /// hand or `UIFont(name: "Outfit", …)` returns nil and every measurement
    /// below quietly becomes a measurement of the SYSTEM font.
    private static func registerTheFont() {
        guard UIFont(name: "Outfit", size: 12) == nil else { return }
        guard let url = Bundle(for: FontScalingPathTests.self)
            .url(forResource: "Outfit-Variable", withExtension: "ttf")
        else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }

    private func traits(_ category: UIContentSizeCategory) -> UITraitCollection {
        UITraitCollection(preferredContentSizeCategory: category)
    }

    func testTheFontIsActuallyLoadedHere() {
        XCTAssertNotNil(
            UIFont(name: "Outfit", size: 12),
            "the measurements in this file are only about Outfit if Outfit is registered"
        )
    }

    // MARK: What the two paths do at the default setting

    /// Whole points survive both paths untouched.
    func testWholePointsAreUntouchedOnBothPaths() throws {
        let font = try XCTUnwrap(UIFont(name: "Outfit", size: 12))
        let metrics = UIFontMetrics(forTextStyle: .body)
        for size in [CGFloat(11), 12, 14, 15, 17] {
            XCTAssertEqual(
                metrics.scaledValue(for: size, compatibleWith: traits(.large)),
                size, accuracy: 0.001, "scaledValue moved \(size)pt"
            )
            XCTAssertEqual(
                metrics.scaledFont(for: font.withSize(size), compatibleWith: traits(.large))
                    .pointSize,
                size, accuracy: 0.001, "scaledFont moved \(size)pt"
            )
        }
    }

    /// A half-point size renders HALF A POINT bigger than designed.
    ///
    /// This is the correction. An earlier commit measured `scaledValue` — which
    /// quantises to thirds, so 11.5 came back 11.666… — and wrote down 1/6 pt as
    /// the drift. But `scaledValue` is the fallback face's path and the symbol
    /// path; a label styled with `.custom(_:size:relativeTo:)` scales the FONT,
    /// and that path quantises to WHOLE POINTS: 11.5 renders at 12. Three times
    /// the drift, on the path essentially all of the app's text takes — there
    /// are ~92 half-point sizes in the scale (9.5 through 15.5).
    ///
    /// Not proven here: that SwiftUI's `.custom(_:relativeTo:)` is literally
    /// implemented over `UIFontMetrics.scaledFont`. It is the only public API
    /// with this behaviour and the numbers match what the app renders, but the
    /// bridge itself is an inference, so this test pins UIKit's contract rather
    /// than claiming to have read SwiftUI's.
    func testHalfPointSizesRenderAtTheWholePointAbove() throws {
        let font = try XCTUnwrap(UIFont(name: "Outfit", size: 12))
        let metrics = UIFontMetrics(forTextStyle: .body)
        for size in [CGFloat(9.5), 10.5, 11.5, 12.5, 13.5, 14.5, 15.5] {
            XCTAssertEqual(
                metrics.scaledFont(for: font.withSize(size), compatibleWith: traits(.large))
                    .pointSize,
                size.rounded(.up), accuracy: 0.001,
                "\(size)pt should render at \(size.rounded(.up))pt"
            )
        }
    }

    /// ...and it is whole points at EVERY setting, not just the default.
    ///
    /// Which is why the drift cannot be dodged by picking a different anchor:
    /// the font path has no fractional sizes to land on.
    func testTheFontPathOnlyEverReturnsWholePoints() throws {
        let font = try XCTUnwrap(UIFont(name: "Outfit", size: 12))
        let metrics = UIFontMetrics(forTextStyle: .body)
        let categories: [UIContentSizeCategory] = [
            .extraSmall, .small, .medium, .large, .extraLarge, .extraExtraLarge,
            .accessibilityMedium, .accessibilityExtraExtraExtraLarge,
        ]
        for category in categories {
            for size in [CGFloat(11), 11.5, 12.5, 14, 14.5] {
                let point = metrics.scaledFont(
                    for: font.withSize(size), compatibleWith: traits(category)
                ).pointSize
                XCTAssertEqual(
                    point, point.rounded(), accuracy: 0.0001,
                    "\(size)pt at \(category.rawValue) came back fractional: \(point)"
                )
            }
        }
    }
}
