/**
 * Gmail → Firestore ingestion of the bank's USD charge notifications.
 *
 * Runs as an Apps Script project bound to the mailbox that receives them, on a
 * time-driven trigger (see README). Apps Script is free and needs no server,
 * which is the whole point: the project has a $0 infrastructure budget and no
 * machine that stays on.
 *
 * What one run does:
 *   1. Search Gmail for recent notification emails.
 *   2. Skip the messages a previous run already filed (message ids remembered
 *      in Script Properties — per MESSAGE, because Gmail groups these into one
 *      thread by subject, so a thread label would hide every later charge).
 *   3. Parse each one (parse.js) and create
 *      households/{id}/bankCharges/{gmailMessageId}.
 *   4. Remember the message id, whether or not a charge came out of it, so a
 *      reversal or a format change is not re-parsed forever.
 *
 * The doc id IS the Gmail message id, so even a lost properties store cannot
 * produce a duplicate charge for a message that is still pending: the create
 * comes back ALREADY_EXISTS and is treated as done.
 *
 * It authenticates as a SERVICE ACCOUNT (its own key, not the backup one, so it
 * can be revoked on its own). A service account is an IAM principal, so the
 * security rules do not apply to it — which is why the rules make bankCharges
 * read-only + deletable from the clients: this script is the only writer.
 *
 * Required Script Properties:
 *   PROJECT_ID      qcris-gastos-diarios
 *   HOUSEHOLD_ID    the households/{id} document id
 *   TIMEZONE        IANA household timezone, e.g. Australia/Sydney
 *   SA_EMAIL        gmail-bank-ingest@<project>.iam.gserviceaccount.com
 *   SA_PRIVATE_KEY  the key's private_key value. Paste it however it comes —
 *                   config.js repairs the shapes the properties box mangles
 * Optional:
 *   GMAIL_QUERY     defaults to the sender + subject below
 *   LOOKBACK_DAYS   defaults to 7
 */

var DEFAULT_QUERY =
  'from:alertas@infomistarjetas.com subject:"Novedades de tus transacciones"';
var DEFAULT_LOOKBACK_DAYS = 7;
var SEEN_PROPERTY = "processedMessageIds";
/** Enough ids to cover the lookback window many times over. */
var SEEN_LIMIT = 400;

/**
 * Read the matching messages, retrying once on a transient Gmail failure.
 *
 * Gmail occasionally refuses a call for no lasting reason — a single run died
 * with "Gmail operation not allowed" at 02:17 one morning while the runs either
 * side of it, fifteen minutes apart, were fine. Apps Script emails the owner
 * about every failed trigger, so without this a blip that healed itself before
 * anyone read the message still sent an alarm.
 *
 * Deliberately ONE extra attempt after a short pause, not a long backoff: the
 * trigger already runs every fifteen minutes, so anything that outlives a couple
 * of seconds is better left to the next tick than to an execution held open
 * against Apps Script's six-minute ceiling. If the second attempt fails too, the
 * error is rethrown — at that point the alarm is worth having.
 */
function readMailbox(query) {
  var attempts = 2;
  for (var attempt = 1; attempt <= attempts; attempt++) {
    try {
      var threads = GmailApp.search(query, 0, 50);
      return GmailApp.getMessagesForThreads(threads);
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(
        "bank-ingest: Gmail read failed (" + error.message +
          "), retrying once in 2s",
      );
      Utilities.sleep(2000);
    }
  }
}

/** Entry point for the time-driven trigger. */
function run() {
  var config = readConfig();
  var seen = readSeen();
  var query =
    config.query + " newer_than:" + config.lookbackDays + "d";

  var messages = readMailbox(query);
  var token = null;
  var imported = 0;
  var skipped = 0;

  for (var t = 0; t < messages.length; t++) {
    for (var m = 0; m < messages[t].length; m++) {
      var message = messages[t][m];
      var id = message.getId();
      if (seen.indexOf(id) !== -1) continue;

      var charge = parseBankNotification(message.getBody(), config.timeZone);
      if (charge === null) {
        // Not a purchase notice (or a shape we do not understand): remember it
        // so we do not re-read it every 15 minutes, and move on.
        seen.push(id);
        skipped++;
        continue;
      }

      if (token === null) token = getAccessToken(config);
      var result = createCharge(config, token, id, charge);
      if (result === "created" || result === "exists") {
        seen.push(id);
        if (result === "created") imported++;
      } else {
        // A transient failure: do NOT mark it seen, so the next run retries.
        console.warn("bank-ingest: could not file message " + id + ": " + result);
      }
    }
  }

  writeSeen(seen);
  console.log(
    "bank-ingest: " + imported + " imported, " + skipped + " ignored, " +
      seen.length + " remembered",
  );
}

/**
 * One-off helper: check the Script Properties without touching Gmail or
 * Firestore. Logs the shape of the key, never the key itself. Run this first
 * when `run` fails with a credentials error.
 */
function checkConfig() {
  var props = PropertiesService.getScriptProperties();
  var required = ["PROJECT_ID", "HOUSEHOLD_ID", "SA_EMAIL", "SA_PRIVATE_KEY"];
  for (var i = 0; i < required.length; i++) {
    var name = required[i];
    var value = props.getProperty(name);
    if (!value) {
      console.log(name + ": MISSING");
    } else if (name === "SA_PRIVATE_KEY") {
      console.log(name + ": " + describePrivateKey(value));
    } else {
      console.log(name + ": " + value);
    }
  }
  console.log("TIMEZONE: " + (props.getProperty("TIMEZONE") || "Australia/Sydney (default)"));
  console.log("GMAIL_QUERY: " + (props.getProperty("GMAIL_QUERY") || DEFAULT_QUERY + " (default)"));

  // Prove the credentials end to end without writing anything.
  try {
    getAccessToken(readConfig());
    console.log("Google token exchange: OK");
  } catch (error) {
    console.log("Google token exchange: FAILED — " + error.message);
  }
}

/** One-off helper: log what the newest matching email parses to. */
function debugLatest() {
  var config = readConfig();
  var threads = GmailApp.search(config.query, 0, 1);
  if (threads.length === 0) {
    console.log("bank-ingest: no matching email found");
    return;
  }
  var message = threads[0].getMessages()[0];
  console.log(message.getId());
  console.log(bankEmailText(message.getBody()).slice(0, 800));
  console.log(JSON.stringify(parseBankNotification(message.getBody(), config.timeZone)));
}

/* ── Config + processed-id memory ──────────────────────────────────────── */

function readConfig() {
  var props = PropertiesService.getScriptProperties();
  var config = {
    projectId: props.getProperty("PROJECT_ID"),
    householdId: props.getProperty("HOUSEHOLD_ID"),
    timeZone: props.getProperty("TIMEZONE") || "Australia/Sydney",
    saEmail: props.getProperty("SA_EMAIL"),
    saKey: props.getProperty("SA_PRIVATE_KEY"),
    query: props.getProperty("GMAIL_QUERY") || DEFAULT_QUERY,
    lookbackDays: Number(props.getProperty("LOOKBACK_DAYS") || DEFAULT_LOOKBACK_DAYS),
  };
  var missing = [];
  if (!config.projectId) missing.push("PROJECT_ID");
  if (!config.householdId) missing.push("HOUSEHOLD_ID");
  if (!config.saEmail) missing.push("SA_EMAIL");
  if (!config.saKey) missing.push("SA_PRIVATE_KEY");
  if (missing.length > 0) {
    throw new Error("bank-ingest: missing Script Properties: " + missing.join(", "));
  }
  return config;
}

function readSeen() {
  var raw = PropertiesService.getScriptProperties().getProperty(SEEN_PROPERTY);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Object.prototype.toString.call(parsed) === "[object Array]" ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeSeen(ids) {
  var trimmed = ids.length > SEEN_LIMIT ? ids.slice(ids.length - SEEN_LIMIT) : ids;
  PropertiesService.getScriptProperties().setProperty(
    SEEN_PROPERTY,
    JSON.stringify(trimmed),
  );
}

/* ── Firestore REST ────────────────────────────────────────────────────── */

/**
 * Create the charge document. Returns "created", "exists" (someone already
 * filed this message — nothing to do) or an error string to retry later.
 */
function createCharge(config, token, messageId, charge) {
  var url =
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(config.projectId) +
    "/databases/(default)/documents/households/" +
    encodeURIComponent(config.householdId) +
    "/bankCharges?documentId=" +
    encodeURIComponent(messageId);

  var fields = {
    usdCents: { integerValue: String(charge.usdCents) },
    date: { stringValue: charge.date },
    merchant: { stringValue: charge.merchant },
    importedAt: { timestampValue: new Date().toISOString() },
  };
  if (charge.cardLast4 !== null) {
    fields.cardLast4 = { stringValue: charge.cardLast4 };
  }

  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  if (code >= 200 && code < 300) return "created";
  if (code === 409) return "exists";
  return "HTTP " + code + " " + response.getContentText().slice(0, 300);
}

/** Service-account JWT → OAuth access token for the Datastore scope. */
function getAccessToken(config) {
  var now = Math.floor(Date.now() / 1000);
  var header = { alg: "RS256", typ: "JWT" };
  var claims = {
    iss: config.saEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  var unsigned =
    base64UrlEncode(JSON.stringify(header)) +
    "." +
    base64UrlEncode(JSON.stringify(claims));
  // normalizePrivateKey (config.js) repairs the shapes a PEM arrives in from
  // the Script Properties box; anything it cannot repair throws with a message
  // that says what to paste, instead of Apps Script's "Invalid argument: key".
  var signature = Utilities.computeRsaSha256Signature(
    unsigned,
    normalizePrivateKey(config.saKey),
  );
  var jwt = unsigned + "." + base64UrlEncodeBytes(signature);

  var response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(
      "bank-ingest: token exchange failed: " + response.getContentText().slice(0, 300),
    );
  }
  return JSON.parse(response.getContentText()).access_token;
}

function base64UrlEncode(text) {
  return base64UrlEncodeBytes(Utilities.newBlob(text).getBytes());
}

function base64UrlEncodeBytes(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}
