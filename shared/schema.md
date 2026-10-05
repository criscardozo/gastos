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
| `cards` | map<last4, Card> \| absent | The household's cards, keyed by their last four digits (see below) |
| `cardFees` | map \| absent | What the credit-card statement adds beyond the purchases, in ARS: `commissionArsCents` (the bank's fixed monthly account fee, typed once) and `usdArsRate` (fallback peso-per-dollar rate, used when the exchange-rate service cannot be reached). Both optional. See `apps/web/src/lib/card-taxes.ts` |
| `ingestRequestedAt` | timestamp \| absent | "Somebody pressed *traer ahora*". The apps stamp it with the SERVER's clock — members only, enforced in the rules — and then ping the Gmail ingestion's web app, which does no work unless it finds a stamp under two minutes old. The authorisation for a manual run is this write, not the HTTP request; see `tools/gmail-bank-ingest/README.md` |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

`Category`: `{ key?: string, name?: string, icon: string, color: string, sortOrder: int,
countsToBudget?: bool, archived?: bool }`
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

`archived` is written **only when true**; absent ⇒ active. An archived category is
kept — its expenses still show its name, icon and colour, where deleting one made
them read "Categoría eliminada" — but it is offered for nothing new: no entry form,
no recurring rule, no CSV row. Unlike `countsToBudget` this one IS enforced: the
rules refuse a new expense in an archived category, and moving an existing one into
it, so an older client or the watch (which carries its own category list) cannot
file there either. Editing an expense already in it is allowed. An id absent from
the map — a category deleted outright — is left as before. Deleting outright is
still possible, from the archived list only.

`Card`: `{ kind: "debit" | "credit", brand?: "visa" | "mastercard" }`, in a map
**keyed by the card's last four digits** — the only identifier the bank ever
gives us. `brand` is meaningful for credit cards (the Tarjetas screen needs it,
and the email never says it) and ignored for debit.

Why it exists: the bank's notification emails name the card only as *"finalizada
en 1234"*, and the ingestion already stores those digits on every charge
(`bankCharges.cardLast4`). Knowing which digits are the debit card and which the
credit one is what lets a charge be routed — a debit charge is a household
expense waiting to be verified, a credit one belongs to a card statement. Same
map-not-array reasoning as `categories`, and the rules validate it the same way:
a map's entries cannot be iterated in rules, so the entry shape is a client
contract. Capped at 6 entries.

**A charge whose digits match nothing configured — or that carries none at all —
is deliberately shown in BOTH places**, flagged as unidentified, rather than
hidden from one. The alternative loses charges silently the day the bank changes
its wording or a new card appears.

### `households/{householdId}/periodBudgets/{startDate}`

One doc per materialized period. **Doc ID = `startDate`** (`YYYY-MM-DD`) → idempotent
materialization (two clients racing write identical content). Periods chain: each new period
starts the day after the previous `endDate`. A period that was answered
(`confirmedAt`) is an immutable historical record of what the budget was (amount +
weekly/fortnightly); one nobody has answered yet can be deleted, which stretching below
needs.

| Field | Type | Notes |
|---|---|---|
| `startDate` | string `YYYY-MM-DD` | Equals the doc ID |
| `endDate` | string `YYYY-MM-DD` | Inclusive. `startDate + (7 or 14) − 1` days |
| `period` | `"weekly"` \| `"fortnightly"` | Type this period was created with |
| `amountCents` | int | This period's **effective** budget — anything carried over from the previous period is already inside it |
| `rolloverCents` | int \| absent | How much of `amountCents` was carried in. Signed: an overspent period carries its deficit forward. Absent ⇒ 0. Explanation only; nothing sums it |
| `source` | `"default"` \| `"custom"` | Whether it came from the default or was set by hand |
| `confirmedAt` | timestamp \| absent | When somebody in the household answered the new-period sheet for this period. Absent ⇒ nobody has, and every client asks. Write-once: the rules accept it added, never changed or removed |
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
- **Answering the start-period screen stamps `confirmedAt`**, even when the
  budget offered is accepted unchanged. That answer is a decision of the
  HOUSEHOLD, not of the device that happened to be in hand: it used to live in
  `UserDefaults` on iOS and `localStorage` on the web, so confirming on the
  phone left the web — and the other member's phone — asking again about a
  period already settled, every period, forever. Clients ask when the current
  period has no `confirmedAt`; the per-device key survives only to suppress the
  sheet for a period that started before that device ever saw the household.
- **Extending the week under way** is the FIRST of three exceptions to that boundary rule.
  Mid-period it can become clear that this week has to cover a fortnight, so
  `period` goes `weekly → fortnightly`, `endDate` moves out by 7 days to exactly
  what `startDate + 13` would have been, `amountCents` grows by whatever is being
  added for the second week, and `source` becomes `"custom"`. `startDate` and
  `rolloverCents` do not move — the latter records what was carried IN at the
  start, which extending does not change.

  The next period still opens on the household's usual weekday: a week running
  Friday 7 → Thursday 13 becomes Friday 7 → Thursday 20, and the next one starts
  Friday 21.

  **No expense is touched.** An expense belongs to whichever period's range
  contains its `date`, so the days that were about to fall into the next period
  fall into this one the moment the boundary moves. That property is exactly why
  expenses store no period id.

  **One-way.** Nothing turns a fortnight back into a week — not the clients, not
  the rules. Shrinking `endDate` would strand any expense already logged in the
  added days between two periods. Both clients therefore ask for a second,
  deliberate confirmation before writing.

  The arithmetic is `extendToFortnight`, implemented twice (TS + Swift) and
  validated against the `extendToFortnight` cases in
  `shared/period-test-vectors.json`. The rules cannot check it — they have no
  date arithmetic — so they only enforce the shape: weekly → fortnightly, end
  date strictly later, start date and carried-in figure untouched, amount never
  shrinking.
- **Stretching a period** is the second, and it exists to move which weekday the
  budget starts on. `endDate` moves out to a chosen date and NOTHING else
  changes — not `amountCents`, not `period`, not `rolloverCents`. It buys DAYS,
  not money: the case it was built for is a week that ended with something left
  over, stretched through Sunday so it gets spent and the next period opens on
  the Monday. A period whose budget grew with its length would be the extend
  above, which is a different decision.

  Because periods chain from `previous.endDate + 1`, moving that one date is the
  whole mechanism — the next period lands on the new weekday with no anchor
  change and nothing to migrate. As with extending, **no expense is touched**:
  the days now inside the longer range simply belong to it.

  The period that was about to start is **deleted in the same batch**, and that
  atomicity is the safety argument: for the instant between the two writes, two
  ranges would claim the same days. It is safe to delete because it carries no
  decision (nobody answered it — the rules refuse to delete a period that has
  `confirmedAt`) and holds no expenses, which live in `expenses` bucketed by
  date. Materialization then rebuilds the chain from the new `endDate + 1`,
  which is why nothing new appears until the stretched period actually ends.

  Forward only, and the reason is the same one that makes shrinking impossible
  everywhere else: days given up would belong to no period at all, so every
  expense logged in them would vanish from every total. Bounded to 31 days from
  `startDate`, past which the date is a typo rather than a stretch.
- **Starting the next period early** is the third, and the only one that moves an
  `endDate` BACK. Asked for on a Sunday (2026-09-27), in a household whose weeks
  run Monday to Sunday: start the new week today instead of waiting. The period
  under way ends yesterday, and the next one starts today and runs to where the
  FOLLOWING period would have ended anyway — current `endDate` + one period of
  the default length — so the usual weekday comes back after it: Sunday 27 →
  Sunday 4 October, eight days, then Monday again. Restarting the chain on the
  new weekday was the alternative, and Cristian declined it.

  What makes shrinking unsafe everywhere else — days given up belonging to no
  period — does not apply, because the new period starts on exactly the first of
  them, **in the same batch**: the cut, the new period (created as
  materialization creates one: default amount, the carry-over when rollover is
  on, no `confirmedAt`), and the deletion of any later period nobody answered
  that it would overlap. A later period somebody DID answer blocks the whole
  thing. The new period being unanswered is the point: every client then shows
  the start-period screen for it, exactly as for any other.

  The arithmetic is `startNextEarly`, twice, against the `startNextEarly`
  vectors: refused on the period's first two days (the cut period must keep two
  — the rules require `endDate > startDate`) and past 31 days. The rules allow
  the shape — `endDate` earlier, nothing else changed, confirmed or not — and
  hold one thing the clients cannot be trusted with: the new `endDate` must be
  within three days of the server clock, so a settled period from the past
  cannot be cut short and its expenses handed to something else.

  The arithmetic is `stretchPeriodTo`; the rules enforce only the shape (end
  date strictly later, everything else identical), exactly as with extending.
- Changing `defaultBudget` affects only future, not-yet-materialized periods.
- **Clients listen to the most recent 26 periods, not all of them** — half a
  year of weeks, a year of fortnights, and the same number on both so they
  agree about how much history exists. An unbounded listener costs one read per
  elapsed period on every open, which grows by 52 a year and never shrinks;
  everything the UI does with the list (the current period, the six-period
  trend, the past-period rows) fits inside that window. The query is newest
  first so the limit drops the oldest. Anything wanting the full record has to
  page it deliberately rather than get it as a side effect of opening the app.

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
| `dismissedAt` | timestamp \| absent | Set when a member discards the charge. Absent means pending — this is the only field a client may ever write |

**Who writes this.** Only the Gmail ingestion (`tools/gmail-bank-ingest`), with
its own service-account key. A service account is an IAM principal, so the
security rules do not apply to it — and the rules therefore make this collection
read-only from the clients, plus deletable and `dismissedAt`-writable. Nobody
should be able to invent a bank charge, and none of what the bank said about it
ever changes.

**How a charge leaves.** Two different exits, deliberately not the same one:

- **Matched** to an expense — deleted on the spot, in the same batch that writes
  that expense's `usdCents` + `verified`. Reconciling is not a mistake anyone
  needs to take back, and a charge that came back after being matched would
  offer to verify an already-verified expense.
- **Dismissed** — `dismissedAt` is stamped and the charge disappears from the
  pending list, but the document stays. For 48 hours it is listed under
  *Descartados* with a Restore button, which clears the field; after that a
  client sweep deletes it for real.

Both clients carry the matcher, validated against `bank-match-vectors.json`. The
ingestion's own memory of processed Gmail message ids is what stops the next
sweep re-importing any of them.

**Why 48 hours is a display window, not a retention guarantee.** With no Cloud
Functions there is nothing server-side to expire a document, so the sweep runs
in whichever client opens the screen. If neither app is opened the odd expired
charge lingers — invisible either way, since every reader hides anything past
the window. The clients agree on the cutoff, not on when it is enforced.

### `households/{householdId}/reckonings/{date}`

"Hacemos las cuentas": the days the household sat down, checked the numbers
against the bank and settled up. The document id **is** the date, `YYYY-MM-DD` in
the household timezone, so pressing twice on one day is the same document and the
collection is the history.

| Field | Type | Notes |
|---|---|---|
| `date` | string `YYYY-MM-DD` | Equal to the document id |
| `createdAt` | timestamp | Server time |

Only the date is kept, not who pressed it (Cristian's call, 2026-10-02).

**Rules.** Members read; a member creates one with the server's clock and exactly
these two fields. Never updated — a second press the same day is
not offered — and deletable, which is how a mistaken press is taken back.

**How the web reads it.** Once, on Datos, newest first, at most 24
(`lib/firebase/reckonings.ts`). Not a listener: the screen is visited.

### `households/{householdId}/ingestStatus/latest`

The ingestion's heartbeat. Its 15-minute trigger can stop without a word —
Google disables a trigger that keeps failing, an authorisation lapses — and
from then on no charge arrives and nothing anywhere says so. This document is
what lets the apps say so.

| Field | Type | Notes |
|---|---|---|
| `ranAt` | timestamp | When the last run FINISHED, written at its end. A run that dies half way does not write it, which is the point |
| `imported` | int | How many charges that run filed. Informational |

**Who writes this.** Only the ingestion, with the same service-account key as
`bankCharges` (rules do not apply to it). Read-only from every client: a member
able to write "it ran a minute ago" could hide exactly the failure this is read
to show. A separate document rather than a field on the household, because a
write every 15 minutes to `households/{id}` would wake both apps' household
listeners 96 times a day.

**How the apps read it.** Once, when the bank section opens, and again after
"Traer del banco" settles — never with a listener. Stale is decided by
`shared/ingest-vectors.json`. An absent document is NOT stale: it is an
ingestion older than this heartbeat, and says nothing about whether it runs.

### `households/{householdId}/recurringRules/{ruleId}`

A merchant pattern the household recognises, and what to file it as when the
bank reports it. **Not the same thing as `services`, and the difference is what
triggers them.** A service is SCHEDULED — Netflix on the 7th, the insurance
every quarter — and its screen asks "has this month's arrived?". A rule here is
not scheduled at all: an Opal top-up happens when it happens, and what fires it
is the charge landing. Neither collection can answer the other's question, which
is why this is not a field on `services`.

| Field | Type | Notes |
|---|---|---|
| `pattern` | string | 1..80. What to look for in `bankCharges.merchant`, e.g. `"Opal*"` |
| `categoryId` | string | 1..40. Required — an expense cannot exist without one, so a rule that could not name a category could never file anything |
| `note` | string | 1..200. What the filed expense's note says |
| `amountAudCents` | int \| **absent** | > 0, ≤ 10_000_000. **Absent is meaningful**: it is the rule saying "ask me". A rule with an amount files the expense on its own; one without can only annotate the charge until somebody answers |
| `createdBy` / `createdAt` / `updatedAt` | | as everywhere else |

**How a pattern matches.** Folded the same way the bank matcher folds a merchant
— lowercase, accents stripped. With no `*` it matches as a **substring**,
because that is how a person writes one: typing `Opal` to catch
`OPAL AUCKLAND ST` is the obvious intent. A `*` is what tightens it — `Opal*`
anchors the start, `*TOPUP` the end, `A*B` both. It is **not** a regular
expression: every other character is literal, so a merchant with a `+` or a `.`
can be matched by typing it. An empty pattern, or one made only of stars,
matches **nothing** — left to the general rule it would claim every charge that
ever arrives, and both the clients and the rules refuse it. Implemented twice
(`apps/web/src/lib/recurring.ts`, `apps/ios/.../RecurringRules.swift`), both
against `shared/recurring-vectors.json`.

**Where it runs.** On the CLIENT, next time one opens — there is no server (Cloud
Functions need the paid plan). That is not a compromise: "tell me next time I
come in" is exactly when a client is running.

**What filing one does**, in a single batch so the two halves cannot separate:
create the expense with `autoRuleId` set to the rule, and set `dismissedAt` on
the charge. The charge is not deleted, which is what makes the 48-hour undo
possible — it is the SAME recoverable-dismissal window a member gets when they
discard a charge by hand (`lib/bank-charges.ts`), and it expires by the same
sweep. Undo inside the window deletes the expense and clears `dismissedAt`, and
the charge is pending again. After it, the sweep removes the charge and the
expense is an ordinary one.

**Two clients, one charge.** Both may be open when a charge arrives, so the
expense id is derived from the charge id rather than generated: two clients
racing write the same document instead of two.

### `households/{householdId}/services/{serviceId}`

A recurring bill — Netflix, the phone, the insurance. A register of **rules**:
what we pay, how much we expect it to be, and when it falls due. Nothing in this
collection is summed against the weekly budget, appears in the period totals, the
statistics or the exports — those all read `expenses`, and so does the money side
of this one.

**The link to the ledger is the NAME, and it is not stored.** When a service is
actually charged it is entered in Gastos like any other expense, in the
`services` category, with the service's name as its note. The Servicios screen
matches the two on a case- and accent-insensitive comparison of that name, and
reports the difference between what was expected and what was charged — with the
expense as the truth, since that is what the bank did. Deliberately derived
rather than a `serviceId` field on the expense: a stored link would have to be
repaired every time somebody renamed a service or fixed a typo in a note, and
this one simply follows. See `apps/web/src/lib/services.ts`.

| Field | Type | Notes |
|---|---|---|
| `name` | string | 1..80, e.g. `"Netflix"` |
| `amountAudCents` | int \| absent | > 0. What it costs in AUD |
| `amountUsdCents` | int \| absent | > 0. What it costs in USD |
| `interval` | `"monthly"` \| `"bimonthly"` \| `"quarterly"` \| `"biannual"` \| `"yearly"` | How often it falls due |
| `dueDay` | int | 1..31. Day of the month it is due |
| `anchorMonth` | int \| absent | 1..12. Which month the cycle lands on. **Required unless `interval == "monthly"`**, absent when monthly (every month is a due month, so there is nothing to anchor) |
| `paidWith` | `"debit"` \| `"credit"` | Which card it is charged to |
| `createdBy` | uid | Attribution only; either member may edit or delete |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

**Both currencies, both typed.** This is the one place a USD figure is entered by
hand rather than coming from the bank, because a service is quoted in whichever
currency its provider bills in and the household wants both on screen. It is
still **not a conversion**: the app computes neither from the other and calls no
FX API — at least one of the two must be present, and each is whatever the bill
says. Nothing sums them together.

**The due date is derived, never stored.** Storing a concrete date would go stale
the moment the month turned. `dueDay` + `interval` (+ `anchorMonth`) is a rule,
and the next occurrence is computed from today in the household timezone, so it
is right forever without anyone maintaining it. A `dueDay` past the end of a
short month clamps to that month's last day (31 → 28, 29 or 30).

### `households/{householdId}/cardStatements/{closingDate}`

One credit-card statement — the window in which charges accumulate. **Doc ID =
`closingDate`**, so creating the same statement twice is idempotent, exactly as
`periodBudgets` uses its `startDate`.

| Field | Type | Notes |
|---|---|---|
| `startDate` | string `YYYY-MM-DD` | First day whose charges belong here — the day after the previous statement's `closingDate` |
| `closingDate` | string `YYYY-MM-DD` | Equals the doc ID. Last day whose charges enter this statement |
| `dueDate` | string `YYYY-MM-DD` | After `closingDate`. The last day it can be paid |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

**There is no `status` field.** The open statement is simply the one with the
greatest `closingDate`; everything before it is closed by the existence of its
successor. "Close this statement and open the next" is therefore a single
create — the closed one is never rewritten — which is why two clients pressing
the button cannot disagree about which statement is current. Statements chain
like periods: `startDate = previous.closingDate + 1 day`.

Deletes are allowed (unlike `periodBudgets`) so a statement opened with the wrong
dates can be undone; its charges are untouched, because charges do not point at
it.

### `households/{householdId}/cardCharges/{chargeId}`

One purchase made with a credit card. **Always USD** — this is the card's own
billing currency and nobody types AUD here.

| Field | Type | Notes |
|---|---|---|
| `date` | string `YYYY-MM-DD` | Household-timezone calendar date |
| `detail` | string | ≤ 200, may be empty |
| `card` | `"visa"` \| `"mastercard"` | Which card it went on |
| `usdCents` | int | > 0. Integer cents of USD |
| `digital` | bool \| absent | A digital service from abroad. **Absent ⇒ false** |
| `verified` | bool \| absent | Checked against the paper statement. **Absent ⇒ false** |
| `createdBy` | uid | Attribution only |
| `createdAt`, `updatedAt` | timestamp | Server timestamps |

**`digital` decides which taxes the charge attracts**, and the bank taxes the two
classes differently: `DB.RG 5617` (30%) falls on all foreign spend, while
`IIBB PERCEP-CABA` (2%) and `IVA RG 4240` (21%) fall only on digital services
from abroad. Verified against a real BBVA statement, which prints both bases:
US$ 531,49 of spend but only US$ 32,21 — the two ride-share charges — under the
second one. The Kmart and Temu purchases on the same statement attracted
neither. The bank decides from how the merchant is registered, so the app cannot
derive it and has to be told. Absent means **false**: the next statement (closing
2026-10-01) taxed one DiDi ride as digital out of thirteen charges — Uber,
Amazon, Bupa, Coles and Starbucks were not. It meant true until 2026-10-05, on
the belief that nearly everything on the card was a digital service, and that
overstated that statement's peso bill by more than half; every charge in
production was given an explicit value when the default flipped.
Only the Tarjetas peso estimate reads it — see `apps/web/src/lib/card-taxes.ts`.

**A charge carries no statement id.** It belongs to the statement whose
`[startDate, closingDate]` range contains its `date` — the same bucketing rule
expenses use for periods, and for the same reason: re-dating a charge moves it to
the right statement by itself, and a statement created or deleted later cannot
leave a charge pointing at nothing. Queries are the same lexicographic string
range, which is why the zero-padded format is mandatory here too.

Unrelated to `bankCharges`: that collection is the bank's own emails, imported to
verify AUD expenses. These are typed by hand and never matched against anything.

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
