import { describe, expect, it } from "vitest";

import { describePrivateKey, normalizePrivateKey } from "./config.js";

/** A stand-in PEM: the shape is what matters here, not real key material. */
const BODY =
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDXamPlE9uUq0Xq" +
  "0aFakePayloadForTestsOnlyNotARealKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "bGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const PEM =
  "-----BEGIN PRIVATE KEY-----\n" +
  BODY.slice(0, 64) + "\n" +
  BODY.slice(64, 128) + "\n" +
  BODY.slice(128) + "\n" +
  "-----END PRIVATE KEY-----\n";

describe("normalizePrivateKey", () => {
  it("leaves a well-formed PEM as a well-formed PEM", () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM);
  });

  it("rebuilds a key the properties box flattened onto one line", () => {
    // This is the one that produces "Invalid argument: key" in Apps Script.
    const flattened = PEM.replace(/\n/g, "");
    expect(normalizePrivateKey(flattened)).toBe(PEM);
  });

  it("accepts the JSON form, where a newline is a backslash and an n", () => {
    const escaped = PEM.replace(/\n/g, "\\n");
    expect(normalizePrivateKey(escaped)).toBe(PEM);
  });

  it("accepts a value copied with its surrounding quotes", () => {
    const quoted = `"${PEM.replace(/\n/g, "\\n")}"`;
    expect(normalizePrivateKey(quoted)).toBe(PEM);
  });

  it("digs the key out of the whole service-account JSON", () => {
    const file = JSON.stringify({
      type: "service_account",
      client_email: "gmail-bank-ingest@example.iam.gserviceaccount.com",
      private_key: PEM,
    });
    expect(normalizePrivateKey(file)).toBe(PEM);
  });

  it("copes with spaces instead of line breaks, and stray whitespace", () => {
    const spaced = `  ${PEM.replace(/\n/g, " ")}  `;
    expect(normalizePrivateKey(spaced)).toBe(PEM);
  });

  it("keeps the label it was given", () => {
    const rsa = PEM.replace(/PRIVATE KEY/g, "RSA PRIVATE KEY");
    expect(normalizePrivateKey(rsa)).toBe(rsa);
  });

  it("says what to paste when it is not a key at all", () => {
    expect(() => normalizePrivateKey("")).toThrow(/not a private key/);
    expect(() => normalizePrivateKey("hunter2")).toThrow(/not a private key/);
    expect(() =>
      normalizePrivateKey(JSON.stringify({ type: "service_account" })),
    ).toThrow(/no private_key field/);
    expect(() =>
      normalizePrivateKey("-----BEGIN PRIVATE KEY-----\n\n-----END PRIVATE KEY-----"),
    ).toThrow(/no key material/);
  });
});

describe("describePrivateKey", () => {
  it("describes the shape without ever echoing the key", () => {
    const description = describePrivateKey(PEM);
    expect(description).toMatch(/^OK · 3 base64 lines/);
    expect(description).not.toContain(BODY.slice(0, 20));
  });

  it("explains a broken one instead of throwing", () => {
    expect(describePrivateKey("nope")).toMatch(/^BROKEN · /);
  });
});
