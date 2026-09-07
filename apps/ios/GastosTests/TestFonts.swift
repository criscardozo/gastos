import CoreText
import UIKit

/// Makes the app's real font available to a test bundle.
///
/// A test bundle has no `UIAppFonts`, so nothing loads Outfit unless a test
/// asks for it. That matters more than it sounds: with the face missing,
/// `AppFont.available` is false and every scaling test silently measures the
/// SYSTEM font instead — which is how the half-point drift got written down as
/// 1/6 pt when the app actually renders half a point off (`FontScalingPathTests`).
///
/// Shared rather than private to one class because registration is
/// process-wide but only happens if some class runs it: a second test file
/// measuring fonts without calling this would measure the fallback and pass.
enum TestFonts {
    static let familyName = "Outfit"
    static let resourceName = "Outfit-Variable"

    /// Why registration did not produce a usable face — so that two different
    /// causes cannot arrive as the same symptom.
    ///
    /// Dropping the font from `project.yml`'s test resources and the font
    /// failing to resolve both end as "Outfit is not available", and a test
    /// reporting the second when the first happened sends you reading
    /// `CTFontManager` instead of a build phase. (Stock's idea, adopted.)
    enum Outcome: Equatable {
        case registered
        case alreadyAvailable
        /// The `.ttf` is not in the test bundle: a build-phase problem, not a
        /// font problem.
        case resourceMissing
        /// It is there and Core Text refused it.
        case registrationFailed(String)
    }

    /// Idempotent, and safe to call from any `setUp`.
    @discardableResult
    static func register() -> Outcome {
        guard UIFont(name: familyName, size: 12) == nil else { return .alreadyAvailable }
        guard let url = Bundle(for: BundleToken.self)
            .url(forResource: resourceName, withExtension: "ttf")
        else { return .resourceMissing }
        var error: Unmanaged<CFError>?
        guard CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) else {
            return .registrationFailed(
                error.map { String(describing: $0.takeRetainedValue()) } ?? "unknown"
            )
        }
        return .registered
    }

    private final class BundleToken {}
}
