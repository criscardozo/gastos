# Gastos Diarios

Household expense tracker for two people sharing one weekly/fortnightly budget.
A SwiftUI iOS app for fast entry, a Next.js web app for everything you sit down
to do, and a Google Apps Script that files the bank's emails — all talking
directly to Firebase (Auth + Firestore, Spark free tier), with no custom backend
and **$0 infrastructure**.

| | |
|---|---|
| 📱 iOS | `apps/ios` — SwiftUI, iOS 26+, Firebase SDK via SPM, offline-first. Home-screen widget + Watch companion |
| 🌐 Web | `apps/web` — Next.js App Router, Tailwind, next-intl (es/en), Vercel. Also an installable **PWA**, which is how it stays on the phone |
| 📧 Bank ingest | `tools/gmail-bank-ingest` — Apps Script on a 15-min trigger, files the bank's USD charge emails for matching |
| 🔥 Firebase | `firebase/` — security rules (the only security boundary), emulator tests |
| 🤝 Contracts | `shared/` — Firestore schema, seed categories, and the test vectors both platforms must pass |
| 📐 Design | `docs/design/` — tokens + Claude Design reference |
| 🗺 Plan | `docs/PLAN.md` — architecture decisions and phases |
| 📜 Rules | `docs/reglas.md` — the project's constraints and the reasoning behind them |

## What it does

Entering an expense and seeing what's left is on **both** clients. So is matching
the bank's charges: the ingestion files each notification email, and either
client suggests which expense it paid for, learning the rate from pairs already
verified.

**Servicios** (recurring bills) and **Tarjetas de Crédito** (card charges grouped
into statements) are **web-only on purpose** — they are sat-down-with tasks, not
things you do at a checkout. Statistics, CSV/PDF/Excel exports and the Drive
upload are web-only for the same reason.

## Quick start

```sh
pnpm install
pnpm dev            # web on :3000
pnpm test           # web unit tests + Firestore rules (emulator, needs Java) + the email parser
pnpm emulators      # Auth 9099, Firestore 8080, UI 4000
cd apps/ios && xcodegen && open GastosDiarios.xcodeproj   # iOS
```

Playwright end-to-end tests (`pnpm --filter web test:e2e`) need the emulators
already running — see the header of `apps/web/playwright.config.ts`.

One-time console setup (Firebase/Vercel/Drive): see [`docs/setup.md`](docs/setup.md).

## Key invariants

- Money is **integer cents**. Dates are `YYYY-MM-DD` strings **in the household
  timezone** — never the device's, never UTC bucketing.
- **One currency (AUD).** It is the only one anyone types and the only one any
  total reads. The app converts nothing and calls no FX API; a USD figure only
  ever comes from the bank, and lives in its own field.
- Each week/fortnight is a materialized `periodBudgets` doc recording **that
  period's** budget, so changing the default never rewrites history. Boundaries
  are fixed, with one fenced exception: the week under way can be stretched into
  a fortnight, which moves its end date and therefore re-buckets the days after
  it. That is the point of it.
- Firestore **security rules are the security boundary**; client config is public.
- **No Cloud Functions** — they require the paid plan. Anything that would want
  a server runs in a client or in the Apps Script.
- Logic duplicated across Swift and TypeScript must pass the shared vectors:
  [`period-test-vectors.json`](shared/period-test-vectors.json) for the calendar
  arithmetic, [`bank-match-vectors.json`](shared/bank-match-vectors.json) for the
  charge matcher. Change the vectors first.

## License

[MIT](LICENSE)
