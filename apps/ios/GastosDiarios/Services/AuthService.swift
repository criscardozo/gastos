import Foundation
import FirebaseAuth
import FirebaseCore
import GoogleSignIn
import UIKit

/// Google Sign-In → Firebase Auth. Detects the GIDClientID placeholder and
/// exposes a friendly "configuration needed" state instead of crashing.
@MainActor
final class AuthService {

    enum AuthError: LocalizedError {
        case configurationNeeded
        case noPresenter
        case missingIDToken

        var errorDescription: String? {
            switch self {
            case .configurationNeeded:
                return "Google Sign-In is not configured yet (placeholder client ID)."
            case .noPresenter:
                return "No view controller available to present sign-in."
            case .missingIDToken:
                return "Google did not return an ID token."
            }
        }
    }

    /// True while GoogleService-Info.plist / Info.plist still carry the
    /// REPLACE_ME placeholders (Google provider not yet enabled in console).
    static var isGoogleSignInConfigured: Bool {
        guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String else {
            return false
        }
        return !clientID.isEmpty && !clientID.contains("REPLACE_ME")
    }

    static func configureGoogleSignIn() {
        guard isGoogleSignInConfigured,
              let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String
        else { return }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
    }

    /// Runs the interactive Google flow and signs into Firebase.
    func signInWithGoogle() async throws {
        guard Self.isGoogleSignInConfigured else { throw AuthError.configurationNeeded }
        Self.configureGoogleSignIn()

        guard let presenter = Self.topViewController() else { throw AuthError.noPresenter }

        let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
        guard let idToken = result.user.idToken?.tokenString else {
            throw AuthError.missingIDToken
        }
        let credential = GoogleAuthProvider.credential(
            withIDToken: idToken,
            accessToken: result.user.accessToken.tokenString
        )
        try await Auth.auth().signIn(with: credential)
    }

    func signOut() throws {
        GIDSignIn.sharedInstance.signOut()
        try Auth.auth().signOut()
    }

    /// URL callback for the Google Sign-In redirect.
    static func handle(url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let root = scenes
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
        else { return nil }
        var top = root
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }
}

// MARK: - Emulator-only sign-in

extension AuthService {

    /// Signs in without Google, against the Auth emulator only.
    ///
    /// The real flow needs a browser and real credentials, which is why every
    /// iOS screen here used to be verified by reading the code rather than by
    /// looking at it. The Auth emulator accepts a fabricated Google credential
    /// (its ID token is plain JSON), so this signs in as a made-up account
    /// against it — and refuses to do anything unless this launch is pointed at
    /// the emulators, so on a real device (including the sideloaded Debug
    /// build) there is no path into it.
    func signInForEmulator(name: String, email: String) async throws {
        guard FirestoreService.emulatorsRequested else {
            throw AuthError.configurationNeeded
        }
        let payload: [String: Any] = [
            "sub": email,
            "email": email,
            "email_verified": true,
            "name": name,
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        let idToken = String(decoding: data, as: UTF8.self)
        let credential = GoogleAuthProvider.credential(
            withIDToken: idToken,
            accessToken: "emulator"
        )
        try await Auth.auth().signIn(with: credential)
    }
}
