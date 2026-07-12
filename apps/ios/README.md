# Gastos Diarios — iOS

SwiftUI app (iOS 17+, MVVM with `@Observable`) for fast household expense entry.
Talks directly to Firebase (Auth + Firestore) — the Firestore security rules in
`firebase/firestore.rules` are the only security boundary.

## Project generation

The Xcode project is generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen)
from `project.yml` (the generated `GastosDiarios.xcodeproj` is committed too so the
project opens without tooling):

```sh
cd apps/ios
xcodegen            # regenerates GastosDiarios.xcodeproj
```

## Build & test

```sh
xcodebuild -project GastosDiarios.xcodeproj -scheme GastosDiarios \
  -destination 'platform=iOS Simulator,name=iPhone 17' build

xcodebuild test -project GastosDiarios.xcodeproj -scheme GastosDiarios \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:GastosDiariosTests
```

The unit tests validate the Swift period logic against every vector in
`shared/period-test-vectors.json` (the same vectors the web TS implementation
must pass).

## Google Sign-In configuration

`GastosDiarios/Resources/GoogleService-Info.plist` is the real Firebase config for
`dev.cardozo.gastosdiarios`, downloaded **after** enabling the Google sign-in
provider, so it carries real `CLIENT_ID` / `REVERSED_CLIENT_ID` values. The same
values are wired in `project.yml` → `Info.plist` (`GIDClientID` and the
`CFBundleURLTypes` URL scheme) — **keep the three in sync**: if the plist is ever
re-downloaded with a different client ID, update `project.yml` and re-run
`xcodegen`.

If the client ID is ever missing or looks like a placeholder, the app still
builds and runs — the sign-in screen shows a friendly "configuration needed"
state instead of crashing (`AuthService.isConfigured`).

## Back Tap → quick entry

Back Tap can't be captured by apps directly; it runs a Shortcut, and the app
ships an App Intent ("Registrar gasto") that opens straight into the
quick-entry tab. One-time setup on the iPhone:

1. Install the app (the intent registers automatically).
2. **Settings → Accessibility → Touch → Back Tap → Double Tap** and pick the
   **Registrar gasto** shortcut (listed under Shortcuts).

Alternative wiring: create a plain Shortcut with "Open URL" →
`gastosdiarios://nuevo` and assign that to Back Tap. Both paths land on the
quick-entry screen; the intent also works via Siri ("Registrar gasto en
Gastos Diarios").

## Firebase emulators

Set the `USE_FIREBASE_EMULATORS` environment variable (e.g. to `1`) in the run
scheme to point the app at the local emulator suite:

- Auth → `localhost:9099`
- Firestore → `localhost:8080`

## Fonts

`Resources/Fonts/Outfit-Variable.ttf` is the Outfit variable font from
[google/fonts](https://github.com/google/fonts/tree/main/ofl/outfit) (OFL licensed).
If the font ever fails to load, the UI falls back to the system rounded design.
