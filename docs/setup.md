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
   **Websites** and add `gastos.cardozo.dev` and `gastos-diarios-web.vercel.app`,
   plus `localhost:3000` for local dev.
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
   add `gastos.cardozo.dev`, or sign-in throws `auth/unauthorized-domain` on
   the new domain.
5. **Make it the canonical URL (optional).** Vercel → Settings → Domains: use
   the `⋯` menu on `gastos.cardozo.dev` → **Set as Production Domain**, then on
   `gastos-diarios-web.vercel.app` choose **Redirect to** → `gastos.cardozo.dev`
   (308). After that the app answers on one canonical URL and the `.vercel.app`
   forwards to it. The in-app "open the web" link (iOS Settings) already points
   at `https://gastos.cardozo.dev`.

`gastos.cardozo.dev` is live (Let's Encrypt cert, auto-renewed).

### Same-origin auth handler (required for the installed PWA)

The app serves Firebase's auth handler from its own origin: `next.config.ts`
rewrites `/__/auth/*` to `<project>.firebaseapp.com`, and `authDomain` is set to
whatever host the app is loaded from (`src/lib/firebase/config.ts`).

Why: with the default cross-origin `authDomain`, Safari's storage partitioning
breaks `signInWithRedirect`, which is why this app used `signInWithPopup`. A
popup cannot be relied on inside an INSTALLED PWA — standalone mode opens a
detached browser context and the handshake back to the app is lost. Serving the
handler same-origin makes redirect work, so the home-screen app can sign in.
The app picks the flow automatically: popup in a browser tab, redirect when
running standalone.

This needs ONE console change per domain that serves the app:

1. **Google Cloud Console** → APIs & Services → **Credentials** → the *Web
   client* OAuth 2.0 client ID (the one Firebase created) → **Authorized
   redirect URIs** → add `https://gastos.cardozo.dev/__/auth/handler`.
   Without it Google rejects the sign-in with **`redirect_uri_mismatch`**.
2. The domain must also be in Firebase Auth → **Authorized domains** (step 4
   above).

Localhost needs no extra setup: `next dev` applies the same rewrite, and
`localhost` is authorized by default.

## Install the PWA on an iPhone

The web app is installable, which is how it stays on the phone permanently —
unlike the sideloaded iOS build, a home-screen web app is not code-signed and
never expires.

1. Open `https://gastos.cardozo.dev` in **Safari** (not Chrome — only Safari can
   install to the home screen on iOS).
2. Share → **Add to Home Screen**.
3. Launch it from the icon. It runs standalone (no browser chrome), signs in via
   redirect (see the same-origin auth handler above) and works offline: the
   shell is precached by the service worker and Firestore keeps its own local
   cache, so expenses entered without signal sync when connectivity returns.

After changing the manifest, remove the icon and re-add it — iOS caches the
manifest at install time.

What a PWA cannot do on iOS, and why the native app still exists: home-screen
widgets, the Apple Watch app, Back Tap / App Intents, and scheduled local
notifications. Both clients read the same Firestore data, so they can be used
interchangeably.

## Google Drive export (one-time, free)

The Datos page can push an export straight to Drive as a Google Sheet. It uses
the narrow `drive.file` scope, which grants access ONLY to files this app
creates — never to the rest of the Drive. The token is requested at export
time (Firebase Auth doesn't retain the OAuth access token), so Google shows a
consent dialog the first time.

Two console steps, without which uploads fail with HTTP 403:

1. **Enable the Drive API** — Google Cloud Console → APIs & Services →
   Library → *Google Drive API* → Enable. Direct link:
   `https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=56331687585`
   Without it Drive answers *"Google Drive API has not been used in project … or
   it is disabled"*.
2. **OAuth consent screen** — if the app is still in *Testing*, add the
   household's Google accounts under **Test users**, otherwise Google refuses
   the extra scope. `drive.file` is a non-sensitive scope, so no app
   verification is required.

The export builds the same styled workbook the Excel download produces and
uploads it with `mimeType: application/vnd.google-apps.spreadsheet`, so Drive
converts it on the way in and the sheet keeps the colours, number formats and
subtotals.

Note for the installed PWA: the consent step uses a popup, which is reliable in
a browser tab but not in standalone mode. Export from the browser if the dialog
doesn't appear.

## Local development

```sh
pnpm install
pnpm emulators          # Firebase emulator suite (Auth 9099, Firestore 8080, UI 4000)
pnpm dev                # Next.js on :3000 — set NEXT_PUBLIC_USE_EMULATORS=1 to use emulators
pnpm test:rules         # security-rules tests (starts its own emulator, needs a JDK 21+)
pnpm test:web           # unit tests, incl. the shared period + bank-match vectors
pnpm test:ingest        # the bank email parser (tools/gmail-bank-ingest)
pnpm test               # all three
pnpm verify:pwa         # service worker + offline cold start (needs a PRODUCTION build served)
```

Playwright end-to-end tests are separate — they need the emulators already
running, then `pnpm --filter web test:e2e`. See the header of
`apps/web/playwright.config.ts`.

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

### Putting one back

`pnpm restore <file>` reads a dump. It targets the **emulator** unless told
otherwise, because rehearsing a restore is the only way to know the backup was
ever worth taking — and rehearsing it against production is not rehearsing.

```sh
# 1. The emulator, under the app's OWN project id (this matters — see
#    docs/reglas.md: started under another one, isMember()'s get() resolves in
#    a namespace with no household and every subcollection reads back empty).
firebase emulators:start --only auth,firestore \
  --config firebase/firebase.json --project qcris-gastos-diarios

# 2. Restore into it and look.
pnpm restore backups/gastos-diarios-<stamp>.json

# 3. Prove the round trip, which is the actual test: back the emulator up
#    again and diff the two dumps. They should differ only in exportedAt.
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm backup
```

For the real thing, `pnpm restore --production <file>`. It refuses unless the
dump's own `project` field matches, then asks you to type the project id. It
**restores, it does not wipe**: documents in the dump are written over what is
there, and documents that exist today but are not in the dump are left alone.

`pnpm backup` reads the emulator too when `FIRESTORE_EMULATOR_HOST` is set,
which is what makes step 3 possible.

### Weekly, without a machine of your own (GitHub Actions)

`.github/workflows/backup.yml` runs the same script every **Thursday morning in
Sydney** (20:00 UTC Wednesday — the offset is baked in so it stays Thursday
across DST) and keeps the dump as a build artifact for 90 days. A run costs a
couple of the 2,000 free Actions minutes a month.

One-time: add the backup key as a repository secret.

```sh
gh secret set FIREBASE_SERVICE_ACCOUNT --repo criscardozo/gastos-diarios \
  < firebase/service-account.json
```

(Or paste the JSON at *Settings → Secrets and variables → Actions → New
repository secret*.) The workflow writes it to a temp file outside the
workspace, points `GOOGLE_APPLICATION_CREDENTIALS` at it, and deletes it after —
though the runner is discarded regardless. Without the secret the job fails
immediately with a message saying so, rather than half-running.

Then check it: `gh workflow run Backup` → *Actions → Backup* → download the
artifact.

Two things to know:

- **Artifacts expire after 90 days** (the free-plan ceiling), so this keeps
  roughly the last three months of Thursdays. Download one if you want to keep it
  forever.
- GitHub disables scheduled workflows in repositories with **60 days of no
  activity**, and emails you before doing it.

## Bank charge ingestion (Gmail → Firestore, free)

The bank bills the card in USD at its own rate and emails a notification per
purchase; an Apps Script files those into `households/{id}/bankCharges` every 15
minutes, and the web app matches each charge to the expense it belongs to.

Full walkthrough — service account, Script Properties, trigger, and how to
re-check the parser when the bank changes its wording — lives in
[`tools/gmail-bank-ingest/README.md`](../tools/gmail-bank-ingest/README.md).

Two things worth repeating here:

- It uses its **own** service-account key (`gmail-bank-ingest@…`), separate from
  the backup one, so either can be revoked without breaking the other. The key
  lives only in the Apps Script project's Script Properties — never in the repo.
- A service account is an IAM principal, so the security rules do NOT apply to
  it. That is why the rules make `bankCharges` read-only from the clients (plus
  deletable): this script is the only writer in the system that rules cannot
  fence in.

## iOS

```sh
cd apps/ios && xcodegen   # generates GastosDiarios.xcodeproj from project.yml
open GastosDiarios.xcodeproj
```

- Requires Xcode 16+. Dependencies (Firebase, GoogleSignIn) resolve via SPM on first open.
- **iOS has no CI at all, on purpose.** macOS runners bill at a 10x minute
  multiplier, and this project's rule is that Actions never costs anything, so
  the iOS app is built and tested locally against a simulator before each
  change lands:
  `xcodebuild test -project GastosDiarios.xcodeproj -scheme GastosDiariosTests -destination 'platform=iOS Simulator,name=<iPhone>'`.
  That scheme builds ONLY the test bundle, which compiles `GastosDiarios/Core`
  directly instead of depending on the app — the app embeds the watchOS app, so
  the old `-scheme GastosDiarios` needed the watchOS platform installed to run a
  unit test. Use `-scheme GastosDiarios` to build or run the app itself.
  Everything that does run on Actions (`CI`, `Backup`) is Ubuntu.
- Signing: personal (free) team → 7-day certificate; re-run from Xcode weekly on each phone.
  This is the documented $0 path until the Apple Developer Program decision (PLAN Phase 5).
- To point the app at the local emulator suite, set the `USE_FIREBASE_EMULATORS`
  environment variable to `1` in the scheme (it targets `localhost` from the
  simulator), or pass `-useEmulators` as a launch argument.
- **Driving the app in a Simulator.** The real sign-in is Google's, which needs a
  browser and real credentials, so screens used to be verified by reading the
  code. Launch with `-useEmulators -devSignIn` and the app signs in against the
  Auth emulator with a fabricated credential — refused outright unless this
  launch is pointed at the emulators, so there is no path into it on a device.
  Then seed a household over the emulator's REST API and deep-link around the
  app: `xcrun simctl openurl booted gastosdiarios://cargos` (also `://nuevo`,
  `://historial`).
