# Scripts and their config

Everything these scripts need to know about this project lives in ONE file:
`scripts/project.json`. The scripts read it; they never contain it. (They were
written to be shared with sibling projects through the kyber repo, retired on
22/10/2026, which is why they take their constants from a file at all — and a
config the scripts read is still better than a constant copied into each.)

## How the scripts find the project

Every script walks UP from its own location until it finds
`scripts/project.json`, and fails with a message naming where it looked when
none exists.

## Keys

Only the keys a script reads are validated, and unknown keys are ignored, so the
file can carry settings no script reads yet.

| key | type | read by | meaning |
| --- | --- | --- | --- |
| `name` | string | backup, run-rules-tests | Short lowercase label. Names dump files (`<name>-<source>-<stamp>.json`) and temp dirs. |
| `projectId` | string | backup, restore, check-rules-drift | The production Firebase project. A service-account key for any other project is refused. |
| `emulatorProjectId` | string | backup, restore | The id `pnpm emulators` runs under. May equal `projectId` on purpose: rules whose `get()` must resolve in the real namespace need the real id. |
| `rulesTestsProjectId` | string | run-rules-tests | The id the rules suite runs the emulator under. |
| `firebaseDir` | path | backup, restore, check-rules-drift, run-rules-tests | Directory holding `firebase.json`, `firestore.rules`, `firestore.indexes.json` and the gitignored `service-account.json`. Relative to the repo root. |
| `rulesTestsDir` | path | run-rules-tests | The rules-tests workspace: `firebase-tools` and `vitest` resolve from there, and `vitest run` runs there. |
| `restore.legacyIsoTimestamps` | boolean, optional | restore | `true` only for a project with real dumps from before the tagged format. Enables the legacy heuristic for dumps without a `format` field. Absent means the heuristic does not exist. |
| `bundleId` | string | install-ios | The app's bundle identifier. Its provisioning profiles are matched on the identifier entitlement, exactly and by prefix — never as a substring. |
| `iosScheme` | string | install-ios | The Xcode scheme, which also names the `.xcodeproj` and the built `.app`. |
| `iosDevice` | string, optional | install-ios | Default device UDID or name. `--device` and `IOS_DEVICE` both win over it. |
| `iosDir` | path, optional | install-ios | Where the Xcode project lives. Defaults to `apps/ios`. |
| `iosTargets` | string[] | set-version | The NAMES of the iOS targets that carry the version. Names and not a count: a count survives a substitution. |
| `webManifest` | path, optional | set-version | The web app's `package.json`. Defaults to `apps/web/package.json`. |
| `iosProject` | path, optional | set-version | The XcodeGen project. Defaults to `apps/ios/project.yml`. |
| `webDir` | path, optional | verify-pwa | The web workspace, where Playwright is resolved from. Defaults to `apps/web`. |
| `pwa` | object | verify-pwa | `port`, `entry`, `precachedRoutes`, `minStaticAssets`, `offlineText`, `deepRoute`, and optionally `signedOutText`. All of it is product identity: the routes, the copy on screen, the port. |

`firebase.json` must declare `emulators.firestore.port`: the scripts take the
project's own port from there and never fall back to Firebase's default.

## Scripts

Wired in the root `package.json` (`pnpm backup`, `pnpm restore`,
`pnpm rules:drift`, `pnpm version:set`, `pnpm install:ios`, `pnpm verify:pwa`)
and, for the rules suite, in `firebase/rules-tests/package.json`. The runner
reads `rulesTestsDir` from the config, so it can be invoked from anywhere in
the repo. `pnpm backup` and `pnpm rules:drift` are also what the weekly job in
the private `criscardozo/my-apps-backups` runs. Their own tests:
`pnpm test:scripts`.

| script | reads | environment |
| --- | --- | --- |
| `backup.mjs` | name, projectId, emulatorProjectId, firebaseDir | `GOOGLE_APPLICATION_CREDENTIALS` for production; `FIRESTORE_EMULATOR_HOST` to read the emulator; `BACKUP_PROJECT_ID` to label an emulator dump. |
| `restore.mjs` | projectId, emulatorProjectId, firebaseDir, `restore.*` | Emulator by default (the project's own port, or `FIRESTORE_EMULATOR_HOST`), only ever a local host. `--production` refuses a dump from another project, a dump not read from production, and a set `FIRESTORE_EMULATOR_HOST`; then asks for the project id typed. |
| `set-version.mjs` | iosTargets, webManifest, iosProject | Nothing. Refuses before writing if a named target is missing, if an unnamed one carries a version, or if any `CFBundleShortVersionString` is a literal instead of `$(MARKETING_VERSION)`. |
| `verify-pwa.mjs` | the `pwa` block, webDir | `PWA_BASE_URL` overrides the host. Needs a PRODUCTION server already running: against a dev server the worker never registers and the check passes without testing anything. |
| `install-ios.mjs` | bundleId, iosScheme, iosDir, iosDevice, webManifest | Sets the app's profiles aside, builds, and refuses to install unless the reissued signature has over a day left AND the built bundle shows the declared version. Puts the profiles back only when the build fails. |
| `check-rules-drift.mjs` | projectId, firebaseDir | `GOOGLE_APPLICATION_CREDENTIALS`. Exit 1 when the deployed ruleset differs from `firestore.rules`. |
| `run-rules-tests.mjs` | name, rulesTestsProjectId, firebaseDir, rulesTestsDir | `FIRESTORE_EMULATOR_PORT` to pin a port (busy means stop, not move). |

## The dump format

```json
{
  "format": 2,
  "name": "<name>",
  "project": "<the project the connection was actually opened to>",
  "source": "production | emulator",
  "exportedAt": "<ISO>",
  "collections": { "<root>": [ { "id": "...", "data": { ... }, "collections": { ... } } ] }
}
```

A document that does not exist but has subcollections under it is written as
`{ "id": "...", "missing": true, "collections": { ... } }`, with no `data`.
Restore puts back what is under it and does not create it. Format 1 left
those subtrees out of the dump without a word; it reads the same otherwise,
so a format 1 dump still restores. A restore older than format 2 refuses a
format 2 dump instead of creating each missing parent as an empty document.

Restore reads and checks the whole dump before it writes the first document:
an unknown tag, a `$timestamp` that is not a date, a document without an id
or without data stops it with nothing written, naming the document.

Timestamps are tagged: `{ "$timestamp": "<ISO instant>" }`, alone in its
object. GeoPoint, DocumentReference, Bytes, NaN and ±Infinity make the backup
stop, naming the document and the field. `source` and `project` describe the
connection that was opened, never an argument. The tag is a guard for the
future, not a repair: a dump written before the format is read exactly as it
was written, and only where the project has opted in
(`restore.legacyIsoTimestamps`).

## The rules-tests helper must not opine

`@firebase/rules-unit-testing` prefers an explicit `host`/`port` in the
`initializeTestEnvironment` config over `FIRESTORE_EMULATOR_HOST`. The runner
starts the emulator on a free port and announces it through that variable, so
the suite's helper passes only `projectId` and `rules`. A helper that also
passes a port makes the suite talk to whatever is on that port — a development
emulator, whose seed it then wipes, in green.
