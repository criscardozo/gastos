# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Implemented from `docs/PLAN.md` (architecture decisions + phases — read it before structural changes). The UI is implemented against the design system in `docs/design/` (`tokens.md` + raw Claude Design HTML export) — use those tokens, don't invent colors.

## What this is

A household expense tracker for 2 users (Cristian + wife) who share a single weekly/fortnightly budget. Two clients, no custom backend:

- `apps/ios/` — SwiftUI app (iOS 17+, MVVM with `@Observable`, Firebase iOS SDK via SPM) optimized for fast expense entry.
- `apps/web/` — Next.js App Router + TypeScript + Tailwind + next-intl, fully client-rendered, deployed on Vercel Hobby. Charts are plain styled divs per the design (no chart library).
- `firebase/` — Firestore security rules, indexes, emulator config, and rules tests (vitest + `@firebase/rules-unit-testing`).
- `shared/` — the cross-platform contract: `schema.md` (Firestore schema source of truth), `categories.json`, `period-test-vectors.json`.

pnpm workspaces for the JS side (web + rules-tests). Swift and TS share no code — only data contracts in `shared/`.

## Hard constraints (do not violate)

- **$0 infra budget.** Firebase Spark plan only — never introduce Cloud Functions (they require the paid Blaze plan). Vercel Hobby for web hosting. No paid services.
- **No custom backend.** Both clients talk directly to Firebase (Auth + Firestore). **Firestore security rules are the only security boundary** — client-side route gating is cosmetic.
- **Money is integer cents** (Swift `Int`, TS `number`). Never floats, never decimal strings. Format with `NumberFormatter` / `Intl.NumberFormat`.
- **Bi-currency (AUD canonical).** `expense.amountCents` is ALWAYS the household canonical currency (AUD) — every total/budget/sum reads it, so the ledger stays deterministic and offline-safe (historical expenses never re-convert when the FX rate moves). An expense entered in USD is converted to AUD at entry time (daily-cached frankfurter snapshot) and stored in `amountCents`, with optional `entryCurrency`/`entryAmountCents` recording the original for display only (never summed). Absent ⇒ entered in AUD. FX is needed only at entry; unavailable ⇒ USD entry disabled, fall back to AUD. The per-user **active currency** (`users/{uid}.defaultEntryCurrency`) seeds the entry switch AND drives the primary display currency everywhere (remaining, totals, rows, widget, watch); both currencies are shown together, with converted figures marked `≈` and stored/original amounts exact. See `shared/schema.md`.
- **Expense dates are `"YYYY-MM-DD"` strings computed in the household's timezone** (stored on the household doc, default `Australia/Sydney`) — never the device timezone, never UTC bucketing.
- **Google Sign-In only** on both platforms (one provider per person — mixing Apple/Google creates two distinct Firebase UIDs for the same person). Web must use `signInWithPopup`, not `signInWithRedirect` (breaks under Safari ITP).
- **Bounded Firestore listeners only** — every expense query must be range-limited by date (`where date >= periodStart && date <= periodEnd`). In React, always return the unsubscribe from `useEffect` (StrictMode double-mount duplicating `onSnapshot` burns the free tier).
- **Source code and comments in English.** Both apps localized in Spanish and English (iOS: String Catalogs; web: next-intl). Conversation with the user is in Spanish (Argentina).
- MIT license.

## Key design decisions (rationale in PLAN.md)

- Household join flow uses the **invite code as the document ID** (`invites/{code}`) because rules cannot secure `where` clause values. Self-add rule caps `memberIds` at 2.
- Period bucketing: an expense belongs to the materialized period whose `[startDate, endDate]` range contains its `date`. The calendar-date arithmetic (add days, today-in-timezone, boundary derivation, cascade materialization) is implemented twice (Swift + TS), both validated against `shared/period-test-vectors.json` (includes Sydney DST and weekly↔fortnightly switch cases).
- Currency: amounts stored in AUD. FX conversion (e.g. → USD) is **display-only** via frankfurter.app, cached daily, never persisted, degrades gracefully to AUD-only.
- Category names: seed categories carry a translatable `key`; user-created ones store a literal `name`. Display rule: `category.key ? t(category.key) : category.name`.
- **Per-period budgets**: `defaultBudget` on the household is only a template. Each real period is a lazily materialized doc in `households/{id}/periodBudgets/{startDate}` recording its own `amountCents`, `period` type (weekly/fortnightly) and date range — an immutable historical record. Periods chain (each starts the day after the previous `endDate`); deterministic doc ID makes materialization idempotent. Changing the default only affects future (not-yet-materialized) periods; the current period is changed by editing its own doc, which never moves period boundaries.

## Commands

All JS commands run from the repo root (pnpm workspace):

- `pnpm dev` — Next.js dev server (`apps/web`).
- `pnpm typecheck && pnpm lint && pnpm build` — web checks.
- `pnpm test:web` — vitest, includes the period-logic vector tests.
- `pnpm test:rules` — Firestore rules tests (spins up the emulator via `firebase emulators:exec`; needs Java).
- `pnpm emulators` — local emulator suite (Auth 9099, Firestore 8080, UI 4000).
- iOS: `cd apps/ios && xcodegen && open GastosDiarios.xcodeproj`. CLI tests:
  `xcodebuild test -project GastosDiarios.xcodeproj -scheme GastosDiarios -destination 'platform=iOS Simulator,name=<iPhone>' -only-testing:GastosDiariosTests`.
- Deploy rules: `firebase deploy --only firestore:rules,firestore:indexes --config firebase/firebase.json --project qcris-gastos-diarios`.
- One-time console setup (Firestore db creation, Google provider, Vercel): `docs/setup.md`. Distribution is free-account sideload (7-day signing expiry) until the Apple Developer decision (PLAN Phase 5).
