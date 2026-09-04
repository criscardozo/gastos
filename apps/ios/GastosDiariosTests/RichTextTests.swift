import SwiftUI
import XCTest

/// Composing one line out of differently styled pieces.
///
/// This replaced `Text + Text`, deprecated on iOS 26, on the two most-read
/// lines in the app: "Gastaste $X de $900 · Quedan 4 días" and each day heading
/// in Historial. What a test can hold onto is the composition — the pieces, in
/// order, carrying the attributes they were given — which is most of what the
/// old chains could get wrong. How it LOOKS still has to be looked at.
final class RichTextTests: XCTestCase {
    func testRunsKeepTheirOrderAndReadAsOneString() {
        let attributed = RichText.attributed([
            .init("Gastaste "),
            .init("$700,00"),
            .init(" de $900"),
        ])
        XCTAssertEqual(String(attributed.characters), "Gastaste $700,00 de $900")
    }

    func testEachRunKeepsItsOwnColourAndFont() {
        // System fonts rather than the app's: what is under test is that a
        // run keeps the font it was handed, not which font that is.
        let bold = Font.system(size: 13, weight: .bold)
        let semibold = Font.system(size: 13, weight: .semibold)
        let attributed = RichText.attributed([
            .init("Gastaste ", color: .gray, font: semibold),
            .init("$700,00", color: .black, font: bold),
        ])
        let runs = Array(attributed.runs)
        XCTAssertEqual(runs.count, 2, "the two styles must stay two runs")
        XCTAssertEqual(runs[0].foregroundColor, .gray)
        XCTAssertEqual(runs[0].font, semibold)
        XCTAssertEqual(runs[1].foregroundColor, .black)
        XCTAssertEqual(runs[1].font, bold)
    }

    func testRunsWithTheSameStyleAreOneRun() {
        // Not a quirk to work around — it is why this stays a single Text: the
        // pieces merge into one paragraph and wrap as one, rather than
        // breaking into stacked views the way an HStack would.
        let font = Font.system(size: 14.5, weight: .bold)
        let attributed = RichText.attributed([
            .init("$900", color: .black, font: font),
            .init(" · Quincenal", color: .black, font: font),
        ])
        XCTAssertEqual(Array(attributed.runs).count, 1)
        XCTAssertEqual(String(attributed.characters), "$900 · Quincenal")
    }

    func testAnUnstyledRunCarriesNothing() {
        // Runs without a colour or font inherit whatever the view sets, which
        // is what lets `.monospacedDigit()` still apply to the whole line.
        let attributed = RichText.attributed([.init("plain")])
        let run = Array(attributed.runs)[0]
        XCTAssertNil(run.foregroundColor)
        XCTAssertNil(run.font)
    }

    func testAnEmptyCompositionIsEmptyRatherThanACrash() {
        XCTAssertEqual(String(RichText.attributed([]).characters), "")
    }
}
