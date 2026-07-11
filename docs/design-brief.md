# Design brief — prompt for Claude Design (claude.ai/design)

Paste the prompt below into a new Claude Design project to design the screens.

---

Design the screens for **"Gastos Diarios"**, a personal expense tracker for a 2-person
household (a couple sharing one budget). Fast-entry-first, warm and personal — not corporate
banking / generic fintech.

## Product context
- Two users (Cristian + his wife) share **one** weekly or fortnightly budget in **AUD**. Both
  see all expenses; each expense shows who logged it.
- Primary platform: **iOS app** (SwiftUI) optimized for logging an expense in under 5 seconds.
  Secondary: **web dashboard** (Next.js) for analysis and full CRUD.
- Bilingual: **Spanish and English** — design with both in mind (Spanish strings run ~25%
  longer; avoid tight fixed-width labels).
- Currency: AUD, with an optional **temporary display toggle** to another currency (e.g. USD),
  shown as approximate (~), never replacing the AUD amount as source of truth.
- **Each period has its own budget**: there is a household default, but every week/fortnight
  can be given a custom amount. Past periods keep a record of what their budget was and
  whether it was weekly or fortnightly — history views compare each period's spend against
  *that period's* budget, not the current default.
- Works offline (iOS): include a subtle "pending sync" state for expenses.

## Visual direction
- Friendly, personal, tactile. Rounded shapes, generous touch targets, high contrast (used
  outdoors, one-handed, mid-grocery-run).
- Light and dark mode.
- Category icons + colors are central to the identity. Seed categories: groceries, coffee,
  eating out, transport, home, health, entertainment, other.
- **The hero of the app is "how much is LEFT this period"** — a big number plus a progress bar
  whose tone shifts as the budget depletes (comfortable → warning → over budget).

## iOS screens (393×852)
1. **Quick entry (home)**: amount-first numeric keypad → tap a category from an icon grid →
   optional short note → save. Date defaults to today (editable). Optimized for one thumb and
   minimal taps. Show remaining budget subtly on this screen too.
2. **Period summary**: remaining amount (hero), spent so far, progress bar, days left in the
   period, per-category breakdown (mini bars), spent-per-person split. The period's budget is
   shown and **editable inline** (pre-filled from the default; a small "custom" badge when it
   differs from the default). When a new period starts, a gentle prompt offers to confirm the
   default or set a custom amount for this week/fortnight.
3. **History**: expenses grouped by day; each row = category icon + note + amount + small
   avatar of who logged it. Swipe actions for edit/delete.
4. **Settings**: default budget (amount, weekly/fortnightly, period start date — clearly
   labeled as the default applied to future periods), display currency toggle, language
   (es/en), invite partner (shareable code with copy action), sign out.
5. **Onboarding**: Google sign-in → create household OR join with an invite code → set the
   budget. Three light steps, no marketing fluff.

## Web screens (1440×900)
1. **Dashboard**: period status (spent vs remaining), category breakdown chart, per-person
   split, trend across recent periods (each bar compares that period's spend vs **its own
   recorded budget** — periods may differ in amount and in weekly/fortnightly length).
2. **Expenses table**: filters (date range, category, person), inline add/edit, grouped or
   flat view.
3. **Settings**: mirror of the iOS settings.

## Components for the design system
Amount display (large tabular numerals), category chip/icon set, budget progress bar (3
states), expense row, period navigator (‹ current period ›), per-period budget editor (default
pre-filled, "custom" badge), new-period budget confirmation prompt, person avatar pair, empty
states (no expenses yet / budget not set / offline), invite-code card, currency-approximate
badge.
