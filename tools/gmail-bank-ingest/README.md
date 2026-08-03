# Gmail → Firestore: the bank's USD charges

The card is paid in AUD but the bank bills it in USD at its own rate and emails a
notification per purchase. This Apps Script files those emails into
`households/{id}/bankCharges`, where the web app matches each charge to the
expense it belongs to (`apps/web/src/lib/bank-match.ts`) and, once confirmed,
writes `usdCents` + `verified` on that expense.

Apps Script was chosen because it is free, runs Google-side (no machine of ours
stays on) and can read the mailbox without any OAuth plumbing of our own — the
project's $0 infrastructure rule leaves no room for Cloud Functions or a server.

## Files

| File | Role |
|---|---|
| `parse.js` | Pure parsing of one email. Shared verbatim between Apps Script and the vitest suite here — this is the risky part, so it is the tested part. |
| `Code.gs` | The sweep: Gmail search → parse → Firestore create, plus the processed-message memory. |
| `fixtures/consumo-autorizado.html` | A real notification, with the cardholder name and card digits scrubbed. |

`pnpm test:ingest` runs the parser tests (12 of them, including the real email
and the Argentina→Sydney date conversion).

## What the email gives us

> Queremos informarte que registramos una autorización de consumo de **U$S
> 63,90** en el establecimiento **COLES 0831**, el día **01/08/2026** a las
> **02:13hs** con la tarjeta de … finalizada en **1234**

USD, merchant, moment, card. **No AUD figure** — which is why the web app learns
the bank's rate from the pairs it already has instead of calling an FX API.

The timestamp is Argentine wall time (ART, a fixed −03). It is converted to the
household timezone before being stored, because a purchase at 9pm in Argentina is
already the next day in Sydney and the matcher looks at dates.

## One-time setup

### 1. Service account (its own, revocable on its own)

```sh
gcloud iam service-accounts create gmail-bank-ingest \
  --display-name="Gmail bank charge ingestion" \
  --project qcris-gastos-diarios

gcloud projects add-iam-policy-binding qcris-gastos-diarios \
  --member="serviceAccount:gmail-bank-ingest@qcris-gastos-diarios.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud iam service-accounts keys create /tmp/gmail-bank-ingest.json \
  --iam-account=gmail-bank-ingest@qcris-gastos-diarios.iam.gserviceaccount.com
```

Deliberately a **different** key from the backup script's: either can be revoked
without breaking the other. The key file never goes near the repo — paste its
`private_key` into a Script Property and delete the file.

> `roles/datastore.user` lets it write any document in the project. Rules do not
> constrain IAM principals, so this key is the one credential in the system that
> is not fenced in by them — keep it out of the repo, and revoke it if the
> mailbox is ever compromised.

### 2. Apps Script project

1. In the Gmail account that receives the notifications, open
   <https://script.google.com> → **New project**.
2. Create two files matching this folder: `parse.js` (as a `.gs` file — paste
   the contents; Apps Script concatenates files, so its functions become
   available to `Code.gs`) and `Code.gs`.
3. **Project Settings → Script Properties**, add:

   | Property | Value |
   |---|---|
   | `PROJECT_ID` | `qcris-gastos-diarios` |
   | `HOUSEHOLD_ID` | the `households/{id}` document id |
   | `TIMEZONE` | `Australia/Sydney` |
   | `SA_EMAIL` | `gmail-bank-ingest@qcris-gastos-diarios.iam.gserviceaccount.com` |
   | `SA_PRIVATE_KEY` | the key's `private_key`, newlines included |
   | `GMAIL_QUERY` | *(optional)* overrides the sender/subject search |
   | `LOOKBACK_DAYS` | *(optional)* defaults to 7 |

4. Run `debugLatest` once. It asks for Gmail + external-request authorisation
   (accept), then logs the parsed charge for the newest matching email — the
   quickest way to confirm the parser still fits the bank's format.
5. Run `run` once and check `bankCharges` in the Firestore console.
6. **Triggers → Add trigger**: function `run`, event source *Time-driven*,
   *Minutes timer*, **every 15 minutes**.

Apps Script quotas on a free account are generous for this: a 15-minute trigger
is ~2,900 runs a month against a 90 min/day runtime allowance, and each run is a
Gmail search plus a couple of HTTPS calls.

## How duplicates are prevented

Two independent layers, because Gmail groups these emails into a single thread by
subject (so a thread label would hide every later charge):

1. **Processed message ids** in Script Properties, per message, capped at 400 and
   paired with a `newer_than:Nd` search. Ids are remembered even when an email
   produces no charge (a reversal, an unfamiliar format), so nothing is re-parsed
   forever.
2. **The document id is the Gmail message id.** A create for a message already
   filed comes back `409 ALREADY_EXISTS` and is treated as done. This is what
   protects a *pending* charge if the properties store is ever lost.

A charge that has been matched or discarded is **deleted** from Firestore. Layer 1
is what stops the next sweep re-creating it, which is why the memory is not
optional.

## When the bank changes the wording

`parseBankNotification` returns `null` rather than guessing, so a format change
means charges silently stop appearing — the failure mode is "nothing arrives",
not "wrong data". Run `debugLatest`, look at the logged text, and adjust the
regexes in `parse.js` (the tests here will tell you if the old cases break).
