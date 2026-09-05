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

    /// Idempotent, and safe to call from any `setUp`.
    static func register() {
        guard UIFont(name: familyName, size: 12) == nil else { return }
        guard let url = Bundle(for: BundleToken.self)
            .url(forResource: "Outfit-Variable", withExtension: "ttf")
        else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }

    private final class BundleToken {}
}
