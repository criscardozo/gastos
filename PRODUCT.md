# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

> This root record carries the product truth both clients share, and its
> platform is the web client's (`apps/web`). The iOS client has its own
> `apps/ios/PRODUCT.md`, which records `ios`, because one record cannot hold two
> platforms and the iPhone app is native SwiftUI, not a wrapped website.

## Users

Two people: Cristian and his wife, one household, sharing a single budget. Both
see every expense, their own and the other's, and the same remaining figure;
each expense records who logged it. There is no third user and no plan for one
(the rules cap a household at two members).

Their situation: logging a purchase at the till or right after it — one-handed,
mid-grocery-run, often outdoors — and, separately, sitting down to see where the
period stands, reconcile the bank's charges, check a card statement against the
paper bill, or export a range.

## Product Purpose

Gastos records the household's daily spending against a budget that resets each
week or fortnight, so both people always know **how much is left in this
period**. That remaining figure is the centre of the product.

Success: an expense is logged in under five seconds, the remaining figure is
right without anyone doing arithmetic, and the end of a period holds no
surprises.

## Positioning

Built for one specific household rather than a market. Each period carries its
own recorded budget — the default is only a template, and a past week keeps
the amount and length it actually had — so history compares each period against
*its own* budget. Expenses are matched against the bank's own charge emails
(the bank's USD figure is stored beside the AUD one, never converted), and the
credit-card side estimates what the Argentine peso bill will be.

## Operating Context

- **iOS app** (`apps/ios`): the one the household uses every day. Quick entry,
  the period summary, history, the bank-charge inbox, Tarjetas, Servicios.
  Also a widget and an Apple Watch app. Distributed by free-account sideload
  (signing expires every seven days).
- **Web app** (`apps/web`): the desktop layout (sidebar, `lg` and up) for
  analysis, the data grid and exports (PDF, Excel, Google Sheets), settings, CSV
  import, Estadísticas. The below-`lg` phone layout and the PWA are
  **deprecated since 2026-09-24** — kept, not maintained.
- **Bank ingest**: an Apps Script files the bank's USD charge emails every 15
  minutes; both apps offer them to be matched to an expense, or filed onto the
  credit-card statement.
- **Rituals**: confirming a new period's budget, starting the next period
  early, "hacemos las cuentas" (a dated record of when the two settled up),
  ticking a card statement's lines against the bank's PDF.

## Capabilities and Constraints

- Money is integer cents. One ledger currency, **AUD**. The only USD figure is
  what the bank actually charged; the only ARS figure is the Tarjetas tax
  estimate, displayed and never stored or summed.
- Expense dates are calendar dates in the household's timezone
  (`Australia/Sydney` by default).
- Google sign-in only. Firebase (Auth + Firestore) on the free Spark plan,
  Vercel Hobby, no custom backend: **$0 infrastructure**, no paid services.
- Bilingual: Spanish (primary) and English, chosen per person in the app, not
  from the device. Spanish strings run ~25% longer.
- One number format in both languages: a point for decimals, no thousands
  grouping ("$1050.00", "US$ 186.90", "$ 241402.75").
- Light and dark mode.
- Works offline on iOS; pending writes show as pending.
- Terminology the UI uses: período, presupuesto, "lo que queda", Historial,
  Tarjetas (resumen, cierre, vencimiento), Servicios, Datos, "hacemos las
  cuentas", cargos del banco.

## Brand Commitments

- Name: **Gastos**.
- Character set by the original design brief (`docs/design-brief.md`):
  warm, personal and tactile — **not corporate banking or generic fintech**.
- The design system already exists and is binding: `docs/design/` (Claude
  Design export + `tokens.md`) and `design-system/tokens.json`, which emits the
  colours and radii into both apps. Category icons and colours are central to
  the identity.

## Evidence on Hand

- Real household data in production (expenses, periods, card statements); none
  of it is for publication.
- The app icon: `docs/design/app-icon/`.
- No marketing site, testimonials or public users, and none should be invented.

## Product Principles

1. **The remaining figure is the answer.** Every screen either feeds it or
   explains it.
2. **Logging is the hot path.** Anything that adds a tap to entering an expense
   needs a reason the household would give.
3. **Never lose a figure, never double-count one.** A charge that might belong
   in two places shows in both rather than in neither; money is never converted
   behind anyone's back.
4. **Two people, one truth.** Both see the same numbers; who did what is
   recorded, not hidden.
5. **Free or it does not exist.** Anything that would cost money runs locally or
   not at all.

## Accessibility & Inclusion

Used one-handed and outdoors: high contrast and generous touch targets were
part of the brief from the start. Dynamic Type and VoiceOver are respected on
iOS (the existing code adapts layouts at accessibility sizes).
