/**
 * Reading the service-account key out of a Script Property.
 *
 * Plain ES5-ish JavaScript, like parse.js: the same source is pasted into the
 * Apps Script project and imported by the vitest suite here.
 *
 * Getting a PEM through the Script Properties UI is the single most fragile
 * step of the setup, and every way it goes wrong produces the same unhelpful
 * "Invalid argument: key" from Utilities.computeRsaSha256Signature. The known
 * shapes people end up pasting:
 *
 *   • The whole service-account JSON, rather than its private_key.
 *   • The value copied WITH its surrounding double quotes.
 *   • The JSON form, whose newlines are the two characters \ and n.
 *   • A key whose line breaks the properties box swallowed, leaving the whole
 *     thing on one line.
 *
 * All four are recoverable without guessing: a PEM is a header, base64, and a
 * footer, so the body is re-wrapped from whatever whitespace survived. What is
 * NOT recoverable — something that is not a key at all — throws with a message
 * that says what to paste instead.
 */

/** Rebuild a usable PEM from whatever made it into the property. */
function normalizePrivateKey(raw) {
  var key = String(raw == null ? "" : raw).trim();

  // The whole service-account JSON.
  if (key.charAt(0) === "{") {
    var parsed = null;
    try {
      parsed = JSON.parse(key);
    } catch (error) {
      parsed = null;
    }
    if (parsed === null || !parsed.private_key) {
      throw new Error(
        "bank-ingest: SA_PRIVATE_KEY looks like JSON but has no private_key field. " +
          "Paste the value of private_key, not the whole file.",
      );
    }
    key = String(parsed.private_key).trim();
  }

  // Copied with its surrounding quotes.
  if (key.charAt(0) === '"' && key.charAt(key.length - 1) === '"') {
    key = key.slice(1, -1).trim();
  }

  // The JSON form, where a newline is the two characters \ and n.
  key = key.replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\r/g, "");

  var match = key.match(
    /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/,
  );
  if (match === null) {
    throw new Error(
      "bank-ingest: SA_PRIVATE_KEY is not a private key. It must be the " +
        "private_key value from the service-account JSON, starting with " +
        "-----BEGIN PRIVATE KEY-----",
    );
  }

  var label = match[1];
  var body = match[2].replace(/\s+/g, "");
  if (body === "") {
    throw new Error("bank-ingest: SA_PRIVATE_KEY has no key material in it.");
  }

  // Re-wrap at 64 characters — which is all a PEM body is, and what the
  // properties box may have flattened away.
  var lines = [];
  for (var i = 0; i < body.length; i += 64) {
    lines.push(body.substr(i, 64));
  }
  return (
    "-----BEGIN " + label + "-----\n" +
    lines.join("\n") +
    "\n-----END " + label + "-----\n"
  );
}

/** A one-line, key-free description for logs: shape only, never material. */
function describePrivateKey(raw) {
  try {
    var normalized = normalizePrivateKey(raw);
    var bodyLines = normalized.trim().split("\n").length - 2;
    return "OK · " + bodyLines + " base64 lines · " + normalized.length + " chars";
  } catch (error) {
    return "BROKEN · " + error.message;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizePrivateKey: normalizePrivateKey,
    describePrivateKey: describePrivateKey,
  };
}
