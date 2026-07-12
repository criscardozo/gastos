# Manual setup (one-time, all free tier)

The Firebase project is `qcris-gastos-diarios`. Client config is public by design — the
security boundary is `firebase/firestore.rules`, never config secrecy.

## Firebase console

1. **Firestore**: create the database in **Native mode** on the **`(default)`** database
   (the Spark free tier only applies to `(default)`). Location: `australia-southeast1`.
2. **Auth**: ✅ done — the **Google** sign-in provider is enabled
   (Authentication → Sign-in method).
3. **Deploy rules & indexes** (from the repo root):
   ```sh
   firebase deploy --only firestore:rules,firestore:indexes --config firebase/firebase.json --project qcris-gastos-diarios
   ```
4. **iOS app config**: ✅ done — `apps/ios/GastosDiarios/Resources/GoogleService-Info.plist`
   carries the real `CLIENT_ID` / `REVERSED_CLIENT_ID` (downloaded after enabling
   the Google provider), and `apps/ios/project.yml` has the matching `GIDClientID`
   + URL scheme. If the plist is ever re-downloaded with a different client ID,
   keep those three in sync and re-run `xcodegen` (see `apps/ios/README.md`).

## Vercel (web)

1. Import the GitHub repo in Vercel; set **Root Directory** to `apps/web`
   (framework: Next.js; install command auto-detects pnpm).
2. No env vars are required to boot — the Firebase client config is committed in
   `apps/web/src/lib/firebase/config.ts`. Optionally override with
   `NEXT_PUBLIC_FIREBASE_*` env vars (same keys as the config object).
3. Add the production domain (`*.vercel.app` and any custom domain) to
   Firebase Auth → Settings → **Authorized domains**, or Google sign-in popups will fail.

## Local development

```sh
pnpm install
pnpm emulators          # Firebase emulator suite (Auth 9099, Firestore 8080, UI 4000)
pnpm dev                # Next.js on :3000 — set NEXT_PUBLIC_USE_EMULATORS=1 to use emulators
pnpm test:rules         # security-rules tests (starts its own emulator)
pnpm test:web           # period-logic + unit tests
```

## iOS

```sh
cd apps/ios && xcodegen   # generates GastosDiarios.xcodeproj from project.yml
open GastosDiarios.xcodeproj
```

- Requires Xcode 16+. Dependencies (Firebase, GoogleSignIn) resolve via SPM on first open.
- Signing: personal (free) team → 7-day certificate; re-run from Xcode weekly on each phone.
  This is the documented $0 path until the Apple Developer Program decision (PLAN Phase 5).
- To point the app at the local emulator suite, set the `USE_FIREBASE_EMULATORS`
  environment variable to `1` in the scheme (it targets `localhost` from the simulator).
