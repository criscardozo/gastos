import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The auth paths must not be framed-denied, and the rule has to come last.
 *
 * Firebase's SDK loads `/__/auth/iframe` in a same-origin iframe, and
 * `X-Frame-Options: DENY` refuses same-origin framing as well — so sign-in in a
 * browser tab died with the browser saying exactly that. It shipped because a
 * comment in `next.config.ts` asserted the opposite ("the handler is a
 * top-level navigation, never an iframe") and nothing executes a comment: true
 * of `/__/auth/handler`, false of `/__/auth/iframe`, and the two are one letter
 * apart in the same sentence.
 *
 * WHAT THIS CANNOT CHECK, which is most of it: the header that actually
 * reaches a browser. Next's own server does not apply these headers to a
 * REWRITTEN path — curl `/__/auth/iframe` against `next start` and Firebase's
 * response comes back with no X-Frame-Options at all — while Vercel does apply
 * them, which is why the bug existed only in production and could only be
 * measured there. So this asserts the decision in the config; the served header
 * is verified by curling the deployment.
 */
describe("the auth handler's frame headers", () => {
  const CONFIG = readFileSync(
    join(import.meta.dirname, "../../next.config.ts"),
    "utf8",
  );

  it("narrows X-Frame-Options for /__/auth, and does it after the blanket rule", () => {
    const blanket = CONFIG.indexOf(`source: "/:path*"`);
    const auth = CONFIG.indexOf(`source: "/__/auth/:path*"`, blanket);

    expect(blanket, "no blanket header rule in next.config.ts").toBeGreaterThan(-1);
    expect(
      auth,
      "no header rule for /__/auth/* — Firebase's same-origin iframe will be denied",
    ).toBeGreaterThan(blanket);

    // Order is the whole mechanism: Next applies every matching rule and the
    // LAST one to set a key wins. Above the blanket rule this file would read
    // as fixed and serve DENY.
    const authBlock = CONFIG.slice(auth, auth + 400);
    expect(
      authBlock,
      "the /__/auth rule does not set X-Frame-Options to SAMEORIGIN",
    ).toMatch(/X-Frame-Options"[^}]*SAMEORIGIN/);

    // And everything else stays denied: the narrowing is for one path prefix,
    // not a decision to let the app be framed.
    expect(CONFIG.slice(blanket, auth)).toMatch(/X-Frame-Options"[^}]*DENY/);
  });

  it("would catch the same bug arriving as a CSP instead", () => {
    // `frame-ancestors` is the same refusal wearing another header, and the
    // rule above does not cover it. There is no CSP here today — the config
    // says at length why not — so this asserts nothing about the present: it
    // is armed for the day somebody writes one, which that same comment
    // contemplates. Reported by the sibling project, which serves
    // `frame-ancestors 'none'` over its own auth rewrite and is saved only by
    // the policy being Report-Only, a state whose purpose is to be promoted.
    //
    // Deliberately vacuous until then. The alternative — a note in a document
    // — is the weakest of the three ways to hold a latent failure, by this
    // repo's own rule, and this one costs a line.
    // Inside a header VALUE, not anywhere in the file: the prose above
    // explaining this trap names `frame-ancestors` three times, and the first
    // version of this armed itself on that and failed with no CSP in sight.
    // A pattern inside a comment is not the thing the pattern names.
    const DECLARED = /value:\s*["'`][^"'`]*frame-ancestors/;
    if (!DECLARED.test(CONFIG)) return;

    // From the blanket rule, not from the top: `source: "/__/auth/:path*"` is
    // in this file TWICE — the rewrite declares the same path — and a bare
    // indexOf finds the rewrite, near line one. Everything after that is the
    // whole file, so the assertion was satisfied by the comment explaining
    // this very trap. It passed the control it was written for.
    const auth = CONFIG.indexOf(
      `source: "/__/auth/:path*"`,
      CONFIG.indexOf(`source: "/:path*"`),
    );
    expect(
      CONFIG.slice(auth),
      "a CSP declares frame-ancestors and the /__/auth rule does not override it — " +
        "sign-in will break exactly as it did with X-Frame-Options",
    ).toMatch(/frame-ancestors/);
  });
});
