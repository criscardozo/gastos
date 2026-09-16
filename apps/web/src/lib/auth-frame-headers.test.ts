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
});
