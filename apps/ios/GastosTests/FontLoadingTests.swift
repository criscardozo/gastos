import UIKit
import XCTest

/// That the app's face loads at all, and lands on the weight it was designed in.
///
/// The original bug was the first of these: the app asked for
/// "Outfit-Regular", a name a variable font does not register, got nil, and
/// fell through to the system face for months without a single test noticing.
/// What is guarded here is the shape of that mistake, not the mistake itself.
final class FontLoadingTests: XCTestCase {
    override class func setUp() {
        super.setUp()
        TestFonts.register()
    }

    /// The `.ttf` reached the test bundle at all.
    ///
    /// Separated from the resolution test on purpose: dropping the font from
    /// `project.yml`'s test resources and the face failing to load both read as
    /// "Outfit is not available", and being told the second when the first
    /// happened sends you into Core Text instead of into a build phase.
    func testTheFontFileIsInTheTestBundle() {
        XCTAssertNotEqual(
            TestFonts.register(), .resourceMissing,
            "Outfit-Variable.ttf is not a resource of the test target — check project.yml"
        )
    }

    /// The name the app actually asks for resolves.
    func testTheFamilyNameResolves() {
        XCTAssertNotNil(
            UIFont(name: TestFonts.familyName, size: 20),
            "the app asks for \"\(TestFonts.familyName)\" and would fall back to the system face"
        )
    }

    /// ...and the names it must NOT ask for still do not.
    ///
    /// Kept as an assertion rather than a comment because it is the whole
    /// reason the family name is the right thing to ask for: a variable font
    /// registers the typographic family and its default instance, not the
    /// per-weight PostScript names a static family would have.
    func testTheStaticWeightNamesDoNotResolve() {
        for name in ["Outfit-Regular", "Outfit-Bold", "Outfit-SemiBold"] {
            XCTAssertNil(
                UIFont(name: name, size: 20),
                "\(name) resolving would mean the font shipped is no longer the variable one"
            )
        }
    }

    /// The family must land on Regular, not on Thin.
    ///
    /// This file's `wght` axis runs 100–900 with a DEFAULT OF 100, which is why
    /// every registered instance is named `Outfit-Thin_…`. If iOS ever resolved
    /// the bare family to that default, every screen in the app would come out
    /// hairline — and "the text went thin" is the kind of thing that gets
    /// blamed on the design rather than on the font. It resolves to Regular
    /// today; this says so out loud so that the day it stops, a test says it
    /// and not a squint.
    ///
    /// (Raised by the Stock session, which found the same default in its own
    /// copy of this file.)
    func testTheFamilyLandsOnRegularAndNotOnTheThinDefault() throws {
        let font = try XCTUnwrap(UIFont(name: TestFonts.familyName, size: 20))
        XCTAssertEqual(
            font.fontDescriptor.object(forKey: .face) as? String, "Regular",
            "the bare family resolved to \(font.fontName), not the Regular face"
        )
    }

    /// The file can express a weight — measured, because the trait cannot.
    ///
    /// `UIFontDescriptor`'s `.weight` trait does NOTHING to this font: asking
    /// for bold through it returns a face that renders identically. The `wght`
    /// axis is what moves it. Scope stated honestly: this proves the FILE can
    /// express weight, not that the app's `.weight()` reaches it — SwiftUI's
    /// mechanism there is not public, and the only check for that path is
    /// looking at the screen. (Also Stock's, who wrote the same caveat after
    /// a fourth assertion of theirs failed for exactly this reason.)
    func testTheFileCanActuallyExpressAWeight() throws {
        let regular = try XCTUnwrap(UIFont(name: TestFonts.familyName, size: 20))
        // 'wght' as a four-character code, which is how the variation axis is keyed.
        let wght = Int(("wght".utf8.reduce(0) { $0 << 8 | UInt32($1) }))
        let bold = UIFont(
            descriptor: UIFontDescriptor(fontAttributes: [
                .name: TestFonts.familyName,
                kCTFontVariationAttribute as UIFontDescriptor.AttributeName: [wght: 700],
            ]),
            size: 20
        )
        let sample = "Gastos diarios" as NSString
        XCTAssertGreaterThan(
            sample.size(withAttributes: [.font: bold]).width,
            sample.size(withAttributes: [.font: regular]).width,
            "wght 700 rendered no wider than the default weight"
        )
    }
}
