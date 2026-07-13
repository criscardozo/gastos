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

## API key restriction (recommended, free, 5 minutes)

The client config is public by design, but restricting each API key cuts off
quota abuse from outside your apps. In
[Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials?project=qcris-gastos-diarios)
(sign in with the project owner account):

1. **iOS key** (`AIzaSyC825...`, auto-created as "iOS key"): under
   *Application restrictions* choose **iOS apps** and add bundle ID
   `dev.cardozo.gastosdiarios`.
2. **Browser key** (`AIzaSyCFjR...`, auto-created as "Browser key"): choose
   **Websites** and add `gastos-diarios-web.vercel.app`, plus
   `localhost:3000` for local dev (and any custom domain later).
3. Leave *API restrictions* on "Don't restrict key" (Firebase needs its own
   set), or restrict to Identity Toolkit + Token Service + Firestore APIs.

## Vercel (web)

1. Import the GitHub repo in Vercel; set **Root Directory** to `apps/web`
   (framework: Next.js; install command auto-detects pnpm).
2. No env vars are required to boot — the Firebase client config is committed in
   `apps/web/src/lib/firebase/config.ts`. Optionally override with
   `NEXT_PUBLIC_FIREBASE_*` env vars (same keys as the config object).
3. Add the production domain (`*.vercel.app` and any custom domain) to
   Firebase Auth → Settings → **Authorized domains**, or Google sign-in popups will fail.

### Custom domain (e.g. `gastos.cardozo.dev`)

The apex `cardozo.dev` is registered at Namecheap. To serve the app from a
subdomain:

1. **Vercel** → project `gastos-diarios-web` → Settings → Domains → add
   `gastos.cardozo.dev`. Vercel shows the DNS record to create — for a
   subdomain it's a **CNAME** (value like `cname.vercel-dns-0.com`; use the
   exact value Vercel displays).
2. **Namecheap** → Domain List → `cardozo.dev` → Manage → Advanced DNS → Add
   New Record: `CNAME Record`, Host `gastos`, Value = the Vercel CNAME target,
   TTL Automatic. Remove any pre-existing record for the `gastos` host.
   (Assumes `cardozo.dev` uses Namecheap BasicDNS; if the nameservers point
   elsewhere, add the CNAME there.)
3. Wait for DNS to propagate (minutes to ~1 h). Vercel auto-provisions the
   HTTPS certificate; the domain flips to "Valid Configuration". `.dev` is
   HSTS-preloaded, so it's always HTTPS.
4. **Firebase Auth** → Authentication → Settings → **Authorized domains** →
   add `gastos.cardozo.dev`, or `signInWithPopup` throws
   `auth/unauthorized-domain` on the new domain. No code change is needed —
   the Firebase `authDomain` stays `qcris-gastos-diarios.firebaseapp.com`.

## Local development

```sh
pnpm install
pnpm emulators          # Firebase emulator suite (Auth 9099, Firestore 8080, UI 4000)
pnpm dev                # Next.js on :3000 — set NEXT_PUBLIC_USE_EMULATORS=1 to use emulators
pnpm test:rules         # security-rules tests (starts its own emulator)
pnpm test:web           # period-logic + unit tests
```

## Backup (manual, free)

Firestore has no free managed export, so `pnpm backup` dumps the whole project
(households + subcollections, users, invites) to a timestamped JSON in
`backups/` (gitignored):

1. Firebase console → Project settings → **Service accounts** → *Generate new
   private key*. Save it as `firebase/service-account.json` (gitignored) or
   anywhere and point `GOOGLE_APPLICATION_CREDENTIALS` at it.
2. `pnpm backup` (or `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json pnpm backup`).

The service account is a GCP feature — free on the Spark plan. Timestamps are
serialized to ISO strings so the JSON round-trips cleanly.

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
