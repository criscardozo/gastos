# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Implemented from `docs/PLAN.md` (architecture decisions + phases — read it before structural changes). The UI is implemented against the design system in `docs/design/` (`tokens.md` + raw Claude Design HTML export) — use those tokens, don't invent colors.

## What this is

A household expense tracker for 2 users (Cristian + wife) who share a single weekly/fortnightly budget. Two clients, no custom backend:

- `apps/ios/` — SwiftUI app (iOS 17+, MVVM with `@Observable`, Firebase iOS SDK via SPM) optimized for fast expense entry.
- `apps/web/` — Next.js App Router + TypeScript + Tailwind + next-intl, fully client-rendered, deployed on Vercel Hobby. Charts are plain styled divs per the design (no chart library). Also an installable **PWA** (service worker in `public/sw.js`, manifest + safe-area handling), which is how the app stays permanently on the iPhone without Apple signing. One codebase, two layouts: sidebar from `lg` up, bottom tab bar below it, with `/nuevo` mirroring the iOS quick-entry screen.
- `firebase/` — Firestore security rules, indexes, emulator config, and rules tests (vitest + `@firebase/rules-unit-testing`).
- `shared/` — the cross-platform contract: `schema.md` (Firestore schema source of truth), `categories.json`, `period-test-vectors.json`, `bank-match-vectors.json`.
- `tools/gmail-bank-ingest/` — Apps Script (free, Google-side, 15-min trigger) that files the bank's USD charge emails into `households/{id}/bankCharges` with its OWN service-account key. Both apps match each charge to an expense using the rate they learn from already-verified pairs — the matcher exists twice (`apps/web/src/lib/bank-match.ts`, `apps/ios/GastosDiarios/Core/BankMatch.swift`) and both run `shared/bank-match-vectors.json`, like the period arithmetic. There is no FX API anywhere. `pnpm test:ingest` covers the email parser.

pnpm workspaces for the JS side (web + rules-tests). Swift and TS share no code — only data contracts in `shared/`.

## Hard constraints (do not violate)

- **$0 infra budget.** Firebase Spark plan only — never introduce Cloud Functions (they require the paid Blaze plan). Vercel Hobby for web hosting. No paid services.
- **No custom backend.** Both clients talk directly to Firebase (Auth + Firestore). **Firestore security rules are the only security boundary** — client-side route gating is cosmetic.
- **Money is integer cents** (Swift `Int`, TS `number`). Never floats, never decimal strings. Format with `NumberFormatter` / `Intl.NumberFormat`.
- **Single currency (AUD).** `expense.amountCents` is the household currency (AUD) — the only currency anyone types and the only one any total/budget/sum reads, so the ledger stays deterministic and offline-safe. The app **converts nothing and calls no FX API** (the old AUD|USD entry switch, `entryCurrency`/`entryAmountCents` and the frankfurter snapshot were removed). A USD figure only ever comes from the bank — the amount it actually charged for the expense — and lives in its own field. See `shared/schema.md`.
- **Expense dates are `"YYYY-MM-DD"` strings computed in the household's timezone** (stored on the household doc, default `Australia/Sydney`) — never the device timezone, never UTC bucketing.
- **Google Sign-In only** on both platforms (one provider per person — mixing Apple/Google creates two distinct Firebase UIDs for the same person). Web serves Firebase's auth handler same-origin (`next.config.ts` rewrites `/__/auth/*`; `authDomain` = the serving host) so BOTH flows work under Safari ITP: popup in a browser tab, `signInWithRedirect` when running as an installed PWA, where a popup's handshake back to a standalone window is unreliable. Adding a domain requires whitelisting `https://<domain>/__/auth/handler` as an OAuth redirect URI — see `docs/setup.md`.
- **Bounded Firestore listeners only** — every expense query must be range-limited by date (`where date >= periodStart && date <= periodEnd`). In React, always return the unsubscribe from `useEffect` (StrictMode double-mount duplicating `onSnapshot` burns the free tier).
- **Source code and comments in English.** Both apps localized in Spanish and English (iOS: String Catalogs; web: next-intl). Conversation with the user is in Spanish (Argentina).
- MIT license.

## Key design decisions (rationale in PLAN.md)

- Household join flow uses the **invite code as the document ID** (`invites/{code}`) because rules cannot secure `where` clause values. Self-add rule caps `memberIds` at 2.
- Period bucketing: an expense belongs to the materialized period whose `[startDate, endDate]` range contains its `date`. The calendar-date arithmetic (add days, today-in-timezone, boundary derivation, cascade materialization) is implemented twice (Swift + TS), both validated against `shared/period-test-vectors.json` (includes Sydney DST and weekly↔fortnightly switch cases).
- Category names: seed categories carry a translatable `key`; user-created ones store a literal `name`. Display rule: `category.key ? t(category.key) : category.name`.
- **Per-period budgets**: `defaultBudget` on the household is only a template. Each real period is a lazily materialized doc in `households/{id}/periodBudgets/{startDate}` recording its own `amountCents`, `period` type (weekly/fortnightly) and date range — an immutable historical record. Periods chain (each starts the day after the previous `endDate`); deterministic doc ID makes materialization idempotent. Changing the default only affects future (not-yet-materialized) periods; the current period is changed by editing its own doc, which never moves period boundaries.

## Commands

All JS commands run from the repo root (pnpm workspace):

- `pnpm dev` — Next.js dev server (`apps/web`).
- `pnpm typecheck && pnpm lint && pnpm build` — web checks.
- `pnpm test:web` — vitest, includes the period-logic vector tests.
- Exports live in `apps/web/src/lib/export/`: `pdf.ts` (jsPDF) and `spreadsheet.ts` (exceljs) render the SAME payload, so Excel/Sheets mirror the PDF. Every export carries both money columns (AUD + the bank's USD, blank when unverified) and a range with unverified expenses is only exported after the consent checkbox is ticked; `drive.ts` uploads the workbook to Drive converted to a Google Sheet (needs the Drive API enabled — see `docs/setup.md`). Both libraries are dynamically imported to stay out of the first-load bundle.
- `pnpm verify:pwa` — PWA smoke check (service worker + offline cold start). Needs a PRODUCTION build already serving: `pnpm build && pnpm --filter web exec next start -p 3112`.
- `pnpm test:rules` — Firestore rules tests (spins up the emulator via `firebase emulators:exec`; needs Java).
- `pnpm emulators` — local emulator suite (Auth 9099, Firestore 8080, UI 4000).
- iOS: `cd apps/ios && xcodegen && open GastosDiarios.xcodeproj`. CLI tests:
  `xcodebuild test -project GastosDiarios.xcodeproj -scheme GastosDiarios -destination 'platform=iOS Simulator,name=<iPhone>' -only-testing:GastosDiariosTests`.
- Deploy rules: `firebase deploy --only firestore:rules,firestore:indexes --config firebase/firebase.json --project qcris-gastos-diarios`.
- `pnpm backup` dumps the whole project to `backups/` (gitignored). The same script runs weekly on GitHub Actions (`.github/workflows/backup.yml`, Thursdays), keeping the dump as a 90-day artifact — Firestore's managed export needs Blaze.
- One-time console setup (Firestore db creation, Google provider, Vercel): `docs/setup.md`. Distribution is free-account sideload (7-day signing expiry) until the Apple Developer decision (PLAN Phase 5).
