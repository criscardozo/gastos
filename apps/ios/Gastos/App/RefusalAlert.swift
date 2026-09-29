import UIKit

/// The alert for a write or a listener the server REFUSED, in a window of its
/// own above everything else.
///
/// It was a SwiftUI `.alert` on the root view, and it was never seen. Measured
/// on the simulator with the emulator refusing every write: the SDK logged the
/// refused delete, `writeError` was set, and UIKit logged "Attempt to present
/// PlatformAlertController … which is already presenting" — the recurring
/// prompt was up, and SwiftUI does not retry. That is not an edge case: most
/// writes here are made from a sheet (an expense's detail, verifying,
/// adjusting the period), and the refusal comes back while the sheet is still
/// up or still sliding away. Moving the modifier onto each phase's view did
/// not help.
///
/// Presenting a UIAlertController on the top controller instead fixed that and
/// broke the other direction, also measured: SwiftUI then failed to present
/// its own sheet over the alert and, reconciling its state a moment later,
/// dismissed whatever the root had presented — the alert. Both failures come
/// from sharing one presentation chain with SwiftUI, so this one does not: a
/// window that exists only while the alert is up, and nothing else presents in.
@MainActor
enum RefusalAlert {
    enum Kind { case write, read }

    private static var window: UIWindow?
    private static weak var shown: UIAlertController?
    private static var shownKind: Kind?

    static func show(kind: Kind, title: String, message: String, done: String) {
        if let shown {
            // A write outranks a read: a read failing a moment later must not
            // cover the change that was lost.
            if shownKind == .write, kind == .read { return }
            shown.title = title
            shown.message = message
            shownKind = kind
            return
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive })
                ?? scenes.first
        else { return }

        let host = UIViewController()
        host.view.backgroundColor = .clear
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.rootViewController = host
        // Visible but not key: whatever was being typed into keeps its focus.
        window.isHidden = false
        Self.window = window

        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: done, style: .default) { _ in
            // Gone with the alert, so the window never sits over the app
            // swallowing touches.
            Self.window?.isHidden = true
            Self.window = nil
            Self.shownKind = nil
        })
        host.present(alert, animated: true)
        shown = alert
        shownKind = kind
    }
}
