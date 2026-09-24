import SwiftUI

/// One `Text` with more than one style in it, without `+`.
///
/// `Text + Text` is deprecated on iOS 26. Its documented replacement is
/// interpolating a Text into another — `Text("\(Text(a).bold()) b")` — and that
/// is the wrong tool HERE: the outer literal becomes a `LocalizedStringKey`, so
/// every one of these strings would be looked up in the string catalog. This
/// app does its own localisation through `L10n`, and the keys such
/// interpolation produces are shapes like `"%@ · %@"` — which the catalog
/// actually contains. A lookup that hits is worse than one that misses.
///
/// An AttributedString avoids the question. It stays a single Text, so a long
/// line still wraps as one paragraph rather than breaking into stacked pieces
/// the way an HStack would.
enum RichText {
    struct Run {
        let text: String
        var color: Color?
        var font: Font?

        init(_ text: String, color: Color? = nil, font: Font? = nil) {
            self.text = text
            self.color = color
            self.font = font
        }
    }

    /// The runs, in order, as one attributed string.
    ///
    /// Separate from `text(_:)` so it can be asserted on: what a test can check
    /// is that the pieces and their attributes are what was asked for, which is
    /// most of what the old `+` chains could get wrong.
    /// The attributes are set by their TYPE, not through the dynamic-member
    /// properties (`piece.foregroundColor = …`).
    ///
    /// Those properties form a key path into `AttributeScopes.SwiftUIAttributes`,
    /// whose types are not `Sendable`, and under `SWIFT_STRICT_CONCURRENCY:
    /// complete` that was the only warning this target emitted — twice, marked
    /// as an error in the Swift 6 language mode. This comment used to say the
    /// fix was Apple's. It was not: the subscript by attribute type forms no
    /// key path at all. Measured on a clean build — two warnings before, none
    /// after — with the tests that assert each run's attributes still passing.
    static func attributed(_ runs: [Run]) -> AttributedString {
        var result = AttributedString()
        for run in runs {
            var piece = AttributedString(run.text)
            if let color = run.color {
                piece[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = color
            }
            if let font = run.font {
                piece[AttributeScopes.SwiftUIAttributes.FontAttribute.self] = font
            }
            result += piece
        }
        return result
    }

    static func text(_ runs: [Run]) -> Text {
        Text(attributed(runs))
    }
}
