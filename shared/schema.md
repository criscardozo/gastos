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
| `displayCurrency` | string \| null | **Deprecated** — the old "also show USD" toggle. No client reads or writes it; the rules still accept it so older builds don't break |
| `defaultEntryCurrency` | `"AUD"` \| `"USD"` \| null | **Deprecated** — AUD is the only entry currency. No client reads or writes it, but the existing user docs still carry it, so the rules keep accepting it (dropping it from `hasOnly()` would make every later update of those docs fail) |
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

`Category`: `{ key?: string, name?: string, icon: string, color: string, sortOrder: int,
countsToBudget?: bool }`
— seed categories carry `key` (translated client-side from `shared/categories.json` ids);
user-created/renamed ones carry a literal `name`. Display rule:
`category.key ? t(category.key) : category.name`.

`countsToBudget` is written **only when false**; absent ⇒ true, so every category
that predates the field keeps counting and no migration is needed. Expenses in an
excluded category are still stored and listed normally — they are left out of the
budget maths (remaining, progress, state, the trend bars) so that things like
health or nights out don't eat the weekly allowance. The rules do not validate
category entries (a map's entries cannot be iterated in rules), so this field
needs no rules change.

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
| `amountCents` | int | This period's **effective** budget — anything carried over from the previous period is already inside it |
| `rolloverCents` | int \| absent | How much of `amountCents` was carried in. Signed: an overspent period carries its deficit forward. Absent ⇒ 0. Explanation only; nothing sums it |
| `source` | `"default"` \| `"custom"` | Whether it came from the default or was set by hand |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

Rules of the chain:
- First period ever: starts at `defaultBudget.anchorDate`.
- Next periods: `startDate = previous.endDate + 1 day`; length from the **current**
  `defaultBudget.period`; `amountCents` from the **current** `defaultBudget.amountCents`.
- Lazy materialization: the first client to open the app inside an unmaterialized range
  creates the doc(s), cascading if several periods elapsed unopened.
- Editing the current period's budget updates `amountCents` and `rolloverCents` (and
  `source: "custom"`) but NEVER moves `startDate`/`endDate`. The two money fields move
  together on purpose: the second is the first's explanation, so letting only one change
  would leave the record contradicting itself. That is what answering the start-period
  screen does when the leftover is included or dropped.
- Changing `defaultBudget` affects only future, not-yet-materialized periods.

### `households/{householdId}/expenses/{expenseId}`

| Field | Type | Notes |
|---|---|---|
| `amountCents` | int | > 0. Always the household `currency` (AUD), integer cents. Everything that sums money (budget, totals, trend, widget, aggregation, CSV) reads this |
| `categoryId` | string | Key into `household.categories` |
| `note` | string | May be empty |
| `date` | string `YYYY-MM-DD` | Local calendar date in the HOUSEHOLD timezone |
| `createdBy` | uid | Attribution only, not ownership — either member can edit/delete |
| `usdCents` | int \| absent | Optional. What the BANK charged for this expense in USD, integer cents. Never typed at entry time and never summed against the budget |
| `verified` | bool \| absent | Whether `usdCents` is known. Absent ⇒ **false** (expenses created before this field, and by older clients) |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

**Single currency.** `amountCents` is the household currency (AUD) — the only
currency anyone types, and the only one any total reads. The app converts
nothing and calls no FX API: the previous bi-currency entry switch, the
`entryCurrency`/`entryAmountCents` pair and the daily frankfurter snapshot are
all gone.

**Verification.** The card is paid in AUD but the bank bills it in USD at its
own rate, and reports that figure by email. So `usdCents` is not a conversion:
it is the bank's own number, copied in after the fact. An expense is
**verified** once it is known and **unverified** until then, which is what
`verified` records — a boolean rather than `usdCents != null` because it is what
the list filters on and what an export gate checks, and reading a flag keeps
those call sites from re-deriving the rule.

`usdCents` and `verified == true` are **co-dependent**: the rules accept them
only together (`usdCents` present ⇒ `verified` true, and vice versa). Clearing a
verification deletes `usdCents` and sets `verified` false. Both fields are
optional so the docs that predate them need no migration, and so an expense
created by an older client (which writes neither) still reads as unverified.

An expense belongs to the period whose `[startDate, endDate]` contains its `date`.
Queries are lexicographic string ranges: `date >= start && date <= end`, which is why the
zero-padded `YYYY-MM-DD` format is mandatory.

### `households/{householdId}/bankCharges/{gmailMessageId}`

A charge the bank reported by email, waiting to be matched to an expense. The
document id **is** the Gmail message id, so re-reading the same email can never
create a second charge.

| Field | Type | Notes |
|---|---|---|
| `usdCents` | int | > 0. What the bank charged, integer cents of USD |
| `date` | string `YYYY-MM-DD` | The charge in the HOUSEHOLD timezone. The email carries Argentine wall time (ART, fixed −03); the ingestion converts it, because a 9pm purchase in Argentina is already the next day in Sydney |
| `merchant` | string | As the bank spells it, e.g. `"COLES 0831"`. May be empty |
| `cardLast4` | string \| absent | Four digits, when the email states them |
| `importedAt` | timestamp | When the ingestion filed it |

**Who writes this.** Only the Gmail ingestion (`tools/gmail-bank-ingest`), with
its own service-account key. A service account is an IAM principal, so the
security rules do not apply to it — and the rules therefore make this collection
read-only from the clients, plus deletable. Nobody should be able to invent a
bank charge, and a charge never changes once imported.

**How a charge leaves.** Deleted, once it has been matched to an expense (in the
same batch that writes that expense's `usdCents` + `verified`) or dismissed —
from either client; both carry the matcher, validated against
`bank-match-vectors.json`. The
ingestion's own memory of processed Gmail message ids is what stops the next
sweep re-importing it.

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
