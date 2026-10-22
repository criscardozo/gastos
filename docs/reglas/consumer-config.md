# The consumer contract

kyber lives at `<consumer>/kyber/` as a git submodule. Everything that is
specific to one consumer lives in ONE file in the consumer:
`<consumer>/.kyber/config.json`. kyber's scripts read it; they never contain it.

## How the scripts find the consumer

Every script walks UP from its own location until it finds
`.kyber/config.json`, and fails with a message naming where it looked when
none exists. It never derives the root from `..` (one level too shallow once
the scripts moved into the submodule, and wrong without failing) and never from
`git rev-parse --show-toplevel` (which, inside a submodule, answers with
kyber's own root).

## Keys

Only the keys a script reads are validated, and unknown keys are ignored, so a
consumer can carry settings for a later batch before kyber reads them.

| key | type | read by | meaning |
| --- | --- | --- | --- |
| `name` | string | backup, run-rules-tests | Short lowercase label. Names dump files (`<name>-<source>-<stamp>.json`) and temp dirs. |
| `projectId` | string | backup, restore, check-rules-drift | The production Firebase project. A service-account key for any other project is refused. |
| `emulatorProjectId` | string | backup, restore | The id `pnpm emulators` runs under. May equal `projectId` on purpose: rules whose `get()` must resolve in the real namespace need the real id. |
| `rulesTestsProjectId` | string | run-rules-tests | The id the rules suite runs the emulator under. |
| `firebaseDir` | path | backup, restore, check-rules-drift, run-rules-tests | Directory holding `firebase.json`, `firestore.rules`, `firestore.indexes.json` and the gitignored `service-account.json`. Relative to the consumer root. |
| `rulesTestsDir` | path | run-rules-tests | The rules-tests workspace: `firebase-tools` and `vitest` resolve from there, and `vitest run` runs there. |
| `restore.legacyIsoTimestamps` | boolean, optional | restore | `true` only for a consumer with real dumps from before the tagged format. Enables the legacy heuristic for dumps without a `format` field. Absent means the heuristic does not exist. |
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

Wire them from the consumer's `package.json`:

```json
{
  "scripts": {
    "backup": "node kyber/scripts/backup.mjs",
    "restore": "node kyber/scripts/restore.mjs"
  }
}
```

`check-rules-drift.mjs` is not wired here: it needs the production service
account, so it runs weekly from the private backups repo, after the dump.

and, in the rules-tests workspace, `"test": "node ../../kyber/scripts/run-rules-tests.mjs"`
(the runner reads `rulesTestsDir` from the config, so it can be invoked from
anywhere in the consumer).

| script | reads | environment |
| --- | --- | --- |
| `backup.mjs` | name, projectId, emulatorProjectId, firebaseDir | `GOOGLE_APPLICATION_CREDENTIALS` for production; `FIRESTORE_EMULATOR_HOST` to read the emulator; `BACKUP_PROJECT_ID` to label an emulator dump. |
| `restore.mjs` | projectId, emulatorProjectId, firebaseDir, `restore.*` | Emulator by default (the consumer's own port, or `FIRESTORE_EMULATOR_HOST`), only ever a local host. `--production` refuses a dump from another project, a dump not read from production, and a set `FIRESTORE_EMULATOR_HOST`; then asks for the project id typed. |
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
was written, and only where the consumer has opted in
(`restore.legacyIsoTimestamps`).

## The rules-tests helper must not opine

`@firebase/rules-unit-testing` prefers an explicit `host`/`port` in the
`initializeTestEnvironment` config over `FIRESTORE_EMULATOR_HOST`. The runner
starts the emulator on a free port and announces it through that variable, so
the consumer's helper passes only `projectId` and `rules`. A helper that also
passes a port makes the suite talk to whatever is on that port — a development
emulator, whose seed it then wipes, in green.

## Consuming kyber

```sh
git submodule add https://github.com/criscardozo/kyber.git kyber
git submodule update --init
```

The submodule URL is HTTPS and kyber is public, so cloning it needs no
credential anywhere: not on a developer's machine, not in CI, not on a deploy
platform.

That is deliberate. A **private** submodule is not deployable on Vercel, which
clones one only when it is publicly reachable over HTTP; a private one fails
with a single `Warning: Failed to fetch one or more git submodules` and the
build continues to a green deploy over an empty directory. Granting the Vercel
GitHub App access does not fix it — measured, with the App on *All
repositories*. kyber avoids the whole class by holding nothing worth hiding.

In GitHub Actions, one line is the whole story:

```yaml
- uses: actions/checkout@v7
  with:
    submodules: true
```

It checks out the commit the gitlink records. A private kyber would need a
read-only deploy key and a second checkout step, because the workflow token is
scoped to the consumer's own repository.

## The weekly backup

**It does not run in the consumer.** It used to: a reusable workflow lived in
kyber and each consumer called it on a schedule, uploading the dump as a
workflow artifact. That was removed on 2026-09-20, and the reason is worth
knowing before anyone rebuilds it.

A workflow artifact on a PUBLIC repository is downloadable by anyone, and both
consumers went public so their CI would stop billing minutes. Artifacts also
expire — ninety days is the ceiling — so the oldest backup disappeared every
week without anyone deciding it should. And the job needs production
admin credentials, which should not sit as a secret in a repository that is
public.

So the dump runs from a **private** repository that checks each app out, runs
`kyber/scripts/backup.mjs` through that app's own submodule, and commits the
result into itself. What the consumer provides is nothing: no workflow, no
secret, no `uses:`. What kyber provides is the script, which is the part that
was ever worth sharing.

Two consequences for a consumer:

- **No `FIREBASE_SERVICE_ACCOUNT` secret.** If one is still configured, it is
  a credential with no caller in a public repository — remove it.
- **A consumer now points at kyber exactly once**, through the gitlink. The
  second pointer was the `uses:` ref, and the guard that kept the two in step
  went with the workflow — not because it has no subject today, but because
  **its subject cannot exist**: kyber publishes no workflow, so nothing here
  can be called by ref. It exited 0 with `No workflow calls kyber` and a file
  count, which is honest output under a name that promises more, and names are
  read before outputs.

  If a reusable workflow is ever published here again, **the guard comes back
  in that same commit**. That is the rule that stops a guard outliving its
  subject: it is born and dies with it, rather than staying on as a souvenir.
