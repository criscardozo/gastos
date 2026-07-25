# Firestore schema — source of truth

This document is the contract both clients (iOS Swift, web TypeScript) implement against.
Firestore has no schema enforcement beyond security rules; **any change here must be mirrored
in `firebase/firestore.rules` and both clients.**

All money amounts are **integer cents** (Swift `Int`, TS `number`). All expense/period dates
are **`"YYYY-MM-DD"` calendar-date strings computed in the household's timezone** — never the
device timezone, never UTC bucketing.

## Collections

### `users/{uid}`

Denormalized per-user convenience. `households/{id}.memberIds` is the source of truth for
authorization, not this doc.

| Field | Type | Notes |
|---|---|---|
| `displayName` | string | From the auth profile; editable |
| `householdId` | string \| null | Set after creating/joining a household |
| `language` | `"es"` \| `"en"` \| null | null → follow system/browser |
| `displayCurrency` | string \| null | **Deprecated** — the old "also show USD" toggle. No client reads or writes it; the rules still accept it so older builds don't break. Superseded by `defaultEntryCurrency` |
| `defaultEntryCurrency` | `"AUD"` \| `"USD"` \| null | The user's **active currency**: it seeds the expense-entry switch AND is the primary display currency across the app (remaining, totals, list rows, widget, watch). The other currency is shown alongside it. null → AUD |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

### `households/{householdId}`

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. "Cristian y Natalia" |
| `currency` | string | ISO 4217, default `"AUD"`. Amounts are stored in this currency |
| `timezone` | string | IANA tz, default `"Australia/Sydney"`. Used for all date bucketing |
| `defaultBudget.amountCents` | int | Template amount for new periods |
| `defaultBudget.period` | `"weekly"` \| `"fortnightly"` | Template period type |
| `defaultBudget.anchorDate` | string `YYYY-MM-DD` | Seeds the FIRST period only |
| `memberIds` | array<string> | uids. Hard cap of 2, enforced in rules |
| `memberProfiles` | map<uid, {displayName, color}> | Denormalized for attribution display |
| `categories` | map<id, Category> | Map keyed by id, NOT an array (see below) |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

`Category`: `{ key?: string, name?: string, icon: string, color: string, sortOrder: int }`
— seed categories carry `key` (translated client-side from `shared/categories.json` ids);
user-created/renamed ones carry a literal `name`. Display rule:
`category.key ? t(category.key) : category.name`.

### `households/{householdId}/periodBudgets/{startDate}`

One doc per materialized period. **Doc ID = `startDate`** (`YYYY-MM-DD`) → idempotent
materialization (two clients racing write identical content). Periods chain: each new period
starts the day after the previous `endDate`. Past periods are an immutable historical record
of what the budget was (amount + weekly/fortnightly).

| Field | Type | Notes |
|---|---|---|
| `startDate` | string `YYYY-MM-DD` | Equals the doc ID |
| `endDate` | string `YYYY-MM-DD` | Inclusive. `startDate + (7 or 14) − 1` days |
| `period` | `"weekly"` \| `"fortnightly"` | Type this period was created with |
| `amountCents` | int | This period's budget |
| `source` | `"default"` \| `"custom"` | Whether it came from the default or was set by hand |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

Rules of the chain:
- First period ever: starts at `defaultBudget.anchorDate`.
- Next periods: `startDate = previous.endDate + 1 day`; length from the **current**
  `defaultBudget.period`; `amountCents` from the **current** `defaultBudget.amountCents`.
- Lazy materialization: the first client to open the app inside an unmaterialized range
  creates the doc(s), cascading if several periods elapsed unopened.
- Editing the current period's budget updates `amountCents` (and `source: "custom"`) but
  NEVER moves `startDate`/`endDate`.
- Changing `defaultBudget` affects only future, not-yet-materialized periods.

### `households/{householdId}/expenses/{expenseId}`

| Field | Type | Notes |
|---|---|---|
| `amountCents` | int | > 0. **Canonical: always the household `currency` (AUD)**, integer cents. Everything that sums money (budget, totals, split, trend, widget, aggregation, CSV) reads this |
| `categoryId` | string | Key into `household.categories` |
| `note` | string | May be empty |
| `date` | string `YYYY-MM-DD` | Local calendar date in the HOUSEHOLD timezone |
| `createdBy` | uid | Attribution only, not ownership — either member can edit/delete |
| `entryCurrency` | `"AUD"` \| `"USD"` \| absent | Optional. The currency the user actually entered. **Absent ⇒ entered in the canonical currency (AUD)** |
| `entryAmountCents` | int \| absent | Optional. The original amount in `entryCurrency`. Present iff `entryCurrency` is. Display-only; never summed |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

**Bi-currency model.** `amountCents` is always AUD (the household canonical
currency) so budgets and every total stay deterministic and offline-safe — no
historical expense re-converts when the FX rate moves. When a user enters an
expense in USD, the client converts USD→AUD with that day's rate (snapshot at
entry time) and stores the AUD result in `amountCents`, plus `entryCurrency:
"USD"` and `entryAmountCents` (the USD the user typed) so the app can display
the original ("US$ 7.00"). Entered in AUD ⇒ both optional fields omitted (docs
stay identical to the pre-bi-currency shape; older expenses need no migration).
FX (frankfurter, daily-cached) is required at entry time; if unavailable the
USD option is disabled and entry falls back to AUD. It is ALSO used, purely for
display, to show both currencies side by side — those converted figures are
always marked `≈`, while `amountCents` and a USD entry's `entryAmountCents` are
exact. The per-user active currency lives on `users/{uid}.defaultEntryCurrency`
(see the users table).

An expense belongs to the period whose `[startDate, endDate]` contains its `date`.
Queries are lexicographic string ranges: `date >= start && date <= end`, which is why the
zero-padded `YYYY-MM-DD` format is mandatory.

### `invites/{code}`

The invite code IS the document ID (capability-as-doc-ID pattern: rules cannot secure
`where` clauses, but they can secure `get` by ID). Code: crypto-random, 10+ chars,
prefixed `GD-` for display.

| Field | Type | Notes |
|---|---|---|
| `householdId` | string | Household to join |
| `createdBy` | uid | Member who created it |
| `createdAt` | timestamp | Server timestamp |

Flow: joiner `get`s `invites/{code}` → reads `householdId` → self-add update on the
household (only touches `memberIds`, only adds self, only while `size < 2`) → writes
`householdId` on their own `users/{uid}` doc.

## Access control summary (see `firebase/firestore.rules`)

- `users/{uid}`: owner only.
- `households/{id}` + subcollections: members only (`request.auth.uid in memberIds`),
  except the self-add join update described above.
- `invites/{code}`: `get` any signed-in user (no `list`); `create`/`delete` members of the
  target household only.
