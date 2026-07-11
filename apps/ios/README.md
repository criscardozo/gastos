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

## Google Sign-In configuration (REQUIRED before sign-in works)

Property lists cannot carry comments, so this is documented here instead:

`GastosDiarios/Resources/GoogleService-Info.plist` is the real Firebase config for
`dev.cardozo.gastosdiarios` **plus two placeholder keys** that Firebase only issues
once the Google sign-in provider is enabled in the console:

| Key | Placeholder value |
|---|---|
| `CLIENT_ID` | `REPLACE_ME.apps.googleusercontent.com` |
| `REVERSED_CLIENT_ID` | `com.googleusercontent.apps.REPLACE_ME` |

The same placeholders appear in `project.yml` → `Info.plist` (`GIDClientID` and the
`CFBundleURLTypes` URL scheme).

To wire up real sign-in (see also `docs/setup.md` at the repo root):

1. In the [Firebase console](https://console.firebase.google.com/project/qcris-gastos-diarios)
   enable **Authentication → Sign-in method → Google**.
2. Re-download `GoogleService-Info.plist` for the iOS app (it now contains real
   `CLIENT_ID` / `REVERSED_CLIENT_ID` values) and replace
   `GastosDiarios/Resources/GoogleService-Info.plist` with it.
3. In `project.yml`, replace both `REPLACE_ME` occurrences:
   - `GIDClientID` → the `CLIENT_ID` value from the plist.
   - The `CFBundleURLSchemes` entry → the `REVERSED_CLIENT_ID` value.
4. Run `xcodegen` again.

Until then the app builds and runs, but the sign-in screen shows a friendly
"configuration needed" state instead of crashing.

## Firebase emulators

Set the `USE_FIREBASE_EMULATORS` environment variable (e.g. to `1`) in the run
scheme to point the app at the local emulator suite:

- Auth → `localhost:9099`
- Firestore → `localhost:8080`

## Fonts

`Resources/Fonts/Outfit-Variable.ttf` is the Outfit variable font from
[google/fonts](https://github.com/google/fonts/tree/main/ofl/outfit) (OFL licensed).
If the font ever fails to load, the UI falls back to the system rounded design.
