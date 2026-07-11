# Gastos Diarios

Household expense tracker for two people sharing one weekly/fortnightly budget.
iOS app (SwiftUI) for fast expense entry + web app (Next.js) for analysis, both talking
directly to Firebase (Auth + Firestore, Spark free tier) — no custom backend.
**$0 infrastructure.**

| | |
|---|---|
| 📱 iOS | `apps/ios` — SwiftUI, iOS 17+, Firebase SDK via SPM, offline-first |
| 🌐 Web | `apps/web` — Next.js App Router, Tailwind, next-intl (es/en), Vercel |
| 🔥 Firebase | `firebase/` — security rules (the only security boundary), emulator tests |
| 🤝 Contracts | `shared/` — Firestore schema, seed categories, cross-platform period test vectors |
| 📐 Design | `docs/design/` — tokens + Claude Design reference |
| 🗺 Plan | `docs/PLAN.md` — architecture decisions and phases |

## Quick start

```sh
pnpm install
pnpm dev            # web on :3000
pnpm test           # period-logic tests + Firestore rules tests (emulator)
cd apps/ios && xcodegen && open GastosDiarios.xcodeproj   # iOS
```

One-time console setup (Firebase/Vercel): see [`docs/setup.md`](docs/setup.md).

## Key invariants

- Money is **integer cents**. Dates are `YYYY-MM-DD` strings **in the household timezone**.
- Each week/fortnight is a materialized `periodBudgets` doc recording **that period's**
  budget (amount + weekly/fortnightly) — history never re-buckets.
- Firestore **security rules are the security boundary**; client config is public.
- Both period-logic implementations (Swift + TS) must pass
  [`shared/period-test-vectors.json`](shared/period-test-vectors.json).

## License

[MIT](LICENSE)
