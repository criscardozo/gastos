# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Implemented from `docs/PLAN.md` (architecture decisions + phases — read it before structural changes). The UI is implemented against the design system in `docs/design/` (`tokens.md` + raw Claude Design HTML export) — use those tokens, don't invent colors.

## What this is

A household expense tracker for 2 users (Cristian + wife) who share a single weekly/fortnightly budget. Two clients, no custom backend:

- `apps/ios/` — SwiftUI app (iOS 26+, MVVM with `@Observable`, Firebase iOS SDK via SPM) optimized for fast expense entry.
- `apps/web/` — Next.js App Router + TypeScript + Tailwind + next-intl, fully client-rendered, deployed on Vercel Hobby. Charts are plain styled divs per the design (no chart library). Also an installable **PWA** (service worker in `public/sw.js`, manifest + safe-area handling), which is how the app stays permanently on the iPhone without Apple signing. One codebase, two layouts: sidebar from `lg` up, bottom tab bar below it, with `/nuevo` mirroring the iOS quick-entry screen.
- `firebase/` — Firestore security rules, indexes, emulator config, and rules tests (vitest + `@firebase/rules-unit-testing`).
- `shared/` — the cross-platform contract: `schema.md` (Firestore schema source of truth), `categories.json`, `period-test-vectors.json`, `bank-match-vectors.json`.
- `tools/gmail-bank-ingest/` — Apps Script (free, Google-side, 15-min trigger) that files the bank's USD charge emails into `households/{id}/bankCharges` with its OWN service-account key. Both apps match each charge to an expense using the rate they learn from already-verified pairs — the matcher exists twice (`apps/web/src/lib/bank-match.ts`, `apps/ios/Gastos/Core/BankMatch.swift`) and both run `shared/bank-match-vectors.json`, like the period arithmetic. There is no FX API anywhere. `pnpm test:ingest` covers the email parser.

pnpm workspaces for the JS side (web + rules-tests). Swift and TS share no code — only data contracts in `shared/`.

## Hard constraints (do not violate)

> The rules Cristian set, with the reasoning behind each — including the process
> ones that don't live in code (when to push, what may cost money, how to verify)
> — are collected in [`docs/reglas.md`](docs/reglas.md). This section stays the
> authoritative short form for the technical ones.

The ones that are not specific to this project live in the `kyber` submodule,
shared with its sibling projects, and are imported here rather than restated —
a second copy of a rule is a rule that can disagree with itself. If these read
as missing, the submodule is not checked out (`git submodule update --init`);
`apps/web/src/lib/kyber.test.ts` is what notices, because a broken import here
fails silently.

@kyber/docs/publicar.md
@kyber/docs/costo-cero.md
@kyber/docs/idiomas.md
@kyber/docs/firestore-free-tier.md
@kyber/docs/codigo.md
@kyber/docs/secretos.md
@kyber/docs/versiones.md


- **$0 infra budget** — see the imported `costo-cero`. For this project that means Firebase Spark (never Cloud Functions: they require Blaze) and Vercel Hobby.
- **No custom backend.** Both clients talk directly to Firebase (Auth + Firestore). **Firestore security rules are the only security boundary** — client-side route gating is cosmetic.
- **Money is integer cents** (Swift `Int`, TS `number`). Never floats, never decimal strings. Format with `NumberFormatter` / `Intl.NumberFormat`.
- **Single currency (AUD).** `expense.amountCents` is the household currency (AUD) — the only currency anyone types and the only one any total/budget/sum reads, so the ledger stays deterministic and offline-safe. The **ledger** converts nothing (the old AUD|USD entry switch, `entryCurrency`/`entryAmountCents` and the frankfurter snapshot were removed). The one FX call in the project is the Tarjetas screen estimating the ARS cost of a card statement (`apps/web/src/lib/usd-rate.ts`, dolarapi oficial, with a hand-entered fallback on the household) — displayed only, never stored, never summed. A USD figure only ever comes from the bank — the amount it actually charged for the expense — and lives in its own field. See `shared/schema.md`.
- **Expense dates are `"YYYY-MM-DD"` strings computed in the household's timezone** (stored on the household doc, default `Australia/Sydney`) — never the device timezone, never UTC bucketing.
- **Google Sign-In only** on both platforms (one provider per person — mixing Apple/Google creates two distinct Firebase UIDs for the same person). Web serves Firebase's auth handler same-origin (`next.config.ts` rewrites `/__/auth/*`; `authDomain` = the serving host) so BOTH flows work under Safari ITP: popup in a browser tab, `signInWithRedirect` when running as an installed PWA, where a popup's handshake back to a standalone window is unreliable. Adding a domain requires whitelisting `https://<domain>/__/auth/handler` as an OAuth redirect URI — see `docs/setup.md`.
- **Bounded Firestore listeners only** — see the imported `firestore-free-tier`. Here that means every expense query is range-limited by date (`where date >= periodStart && date <= periodEnd`); StrictMode double-mount duplicating `onSnapshot` is what burns the free tier.
- **Source code and comments in English** — see the imported `idiomas`. Both apps are localized in Spanish and English (iOS: String Catalogs; web: next-intl).
- MIT license.

## Key design decisions (rationale in PLAN.md)

- Household join flow uses the **invite code as the document ID** (`invites/{code}`) because rules cannot secure `where` clause values. Self-add rule caps `memberIds` at 2.
- Period bucketing: an expense belongs to the materialized period whose `[startDate, endDate]` range contains its `date`. The calendar-date arithmetic (add days, today-in-timezone, boundary derivation, cascade materialization) is implemented twice (Swift + TS), both validated against `shared/period-test-vectors.json` (includes Sydney DST and weekly↔fortnightly switch cases).
- Category names: seed categories carry a translatable `key`; user-created ones store a literal `name`. Display rule: `category.key ? t(category.key) : category.name`.
- **Per-period budgets**: `defaultBudget` on the household is only a template. Each real period is a lazily materialized doc in `households/{id}/periodBudgets/{startDate}` recording its own `amountCents`, `period` type (weekly/fortnightly) and date range — an immutable historical record. Periods chain (each starts the day after the previous `endDate`); deterministic doc ID makes materialization idempotent. Changing the default only affects future (not-yet-materialized) periods; the current period is changed by editing its own doc. Editing the amount never moves boundaries — but **stretching a week into a fortnight does, on purpose**: it pushes `endDate` out by 7 days, which re-buckets the days that were about to fall into the next period. That is the one sanctioned exception, one-way, and fenced by its own branch in the rules.

## Commands

All JS commands run from the repo root (pnpm workspace):

- `pnpm dev` — Next.js dev server (`apps/web`).
- `pnpm typecheck && pnpm lint && pnpm build` — web checks.
- `pnpm test:web` — vitest, includes the period-logic vector tests.
- **Servicios is a register of rules; the money lives in `expenses`.** A charged service is an ordinary expense in the `services` category whose note is the service's name — the screen links the two by that name (nothing stored) and offers to move the rule onto whatever was actually charged. The two figures at the top are this month's: what it costs, and how much has landed.
- `/datos` is a GRID first: the range's expenses on screen with the export's own columns, sortable and filterable, and every export writes exactly what is on screen in that order. Importing a CSV lives in **Ajustes** (`components/import-expenses.tsx`) — it is the one control on either screen that writes rows.
- Exports live in `apps/web/src/lib/export/`: `pdf.ts` (jsPDF) and `spreadsheet.ts` (exceljs) render the SAME payload, so Excel/Sheets mirror the PDF. Every export carries both money columns (AUD + the bank's USD, blank when unverified) and a range with unverified expenses is only exported after the consent checkbox is ticked; `drive.ts` uploads the workbook to Drive converted to a Google Sheet (needs the Drive API enabled — see `docs/setup.md`). Both libraries are dynamically imported to stay out of the first-load bundle.
- `pnpm verify:pwa` — PWA smoke check (service worker + offline cold start). Needs a PRODUCTION build already serving: `pnpm build && pnpm --filter web exec next start -p 3112`.
- `pnpm test:rules` — Firestore rules tests. Picks a FREE port rather than
  insisting on one (`kyber/scripts/run-rules-tests.mjs`, shared) — it tries the
  project's own port first and falls back only if it is taken, because on this
  machine a port is often held by a Docker stack or a leftover emulator and the
  failure read as a broken test run. Pin one with `FIRESTORE_EMULATOR_PORT`.
  Needs a **JDK 21 or newer** — firebase-tools 15 dropped older ones, and on
  Java 17 it refuses to start rather than warning.
- `pnpm emulators` — local emulator suite on **this project's own port block**:
  Auth 9390, Firestore 8390 (websocket 9490), UI 4390, hub 4690, logging 4790.
  NOT Firebase's defaults: on this machine SSH port forwards hold 4000, 8080,
  8085, 9099, 9150 and 9199 — the whole default set — and 8085 is `stock`'s
  Firestore, so the defaults never bind and a neighbouring project would take
  whatever did. The numbers live in `firebase/firebase.json` and are mirrored
  in every copy that cannot read it — the list is in
  `apps/web/src/lib/emulator-ports.test.ts`, which is also what holds them to
  it. No count here: this line said "four" while that list held seven.
  Start it with **`--project qcris-gastos-diarios`** when an app will connect:
  under any other project id the rules resolve `isMember()`'s `get()` in a
  namespace with no household, which is an evaluation error, and every
  subcollection reads back empty with no error at all (`docs/reglas.md`).
- iOS: `cd apps/ios && xcodegen && open Gastos.xcodeproj`. CLI tests:
  `xcodebuild test -project Gastos.xcodeproj -scheme GastosTests -destination 'platform=iOS Simulator,name=<iPhone>'`.
  That scheme builds ONLY the test bundle, which compiles `Gastos/Core`
  directly instead of depending on the app — the app embeds the watchOS app, so
  the old `-scheme Gastos` needed the watchOS platform installed to run a
  unit test. Use `-scheme Gastos` to build or run the app itself.
- `./scripts/install-ios.sh` — build + **renovación forzada de la firma** +
  install en el iPhone. Instalar siempre renueva: el perfil del team gratuito se
  reusa, así que un build normal conserva el vencimiento viejo y cada instalación
  gasta días del mismo perfil. El script aparta los tres perfiles juntos (app,
  widget, watch — para que se reemitan alineados), captura el exit code del build
  ANTES de leer nada (`xcodebuild | grep` devuelve el código de grep, no del
  build), restaura los perfiles si falla y aborta si la firma emitida dura menos
  de un día.
- Deploy rules: `firebase deploy --only firestore:rules,firestore:indexes --config firebase/firebase.json --project qcris-gastos-diarios`.
- `pnpm backup` dumps the whole project to `backups/` (gitignored), and
  `pnpm restore <file>` puts one back — into the EMULATOR unless
  `--production`, because a backup nobody has read back is a hope. The same
  script runs weekly on GitHub Actions (`.github/workflows/backup.yml`,
  Thursdays), keeping the dump as a 90-day artifact — Firestore's managed
  export needs Blaze. That job also runs `kyber/scripts/check-rules-drift.mjs`, which
  fails if the deployed ruleset is not the one in this repo.
- One-time console setup (Firestore db creation, Google provider, Vercel): `docs/setup.md`. Distribution is free-account sideload (7-day signing expiry) until the Apple Developer decision (PLAN Phase 5).
