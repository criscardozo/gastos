import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

import pkg from "./package.json" with { type: "json" };

/**
 * Build stamp for the version card in Ajustes.
 *
 * Resolved HERE, at build time, rather than hardcoded in a component: a string
 * someone has to remember to bump is a string that lies. On Vercel the commit
 * comes from the build environment; locally it comes from git; in the rare case
 * of neither (a tarball build) the card simply says "unknown" instead of
 * inventing something.
 */
function commitSha(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel !== undefined && fromVercel !== "") {
    return fromVercel.slice(0, 7);
  }
  try {
    // execFile, not exec: no shell, so nothing here can be word-split or
    // interpreted even if the arguments ever stop being literals.
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

/** When the commit itself was authored — what "last updated" actually means to
 * a reader. Falls back to build time when git is unavailable. */
function commitDate(): string {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cI"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return new Date().toISOString();
  }
}

// Firebase's hosted auth handler, proxied below so it is served from OUR
// origin. Overridable for a different project.
const AUTH_HANDLER_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST ??
  "qcris-gastos-diarios.firebaseapp.com";

const nextConfig: NextConfig = {
  // Fully client-rendered app behind a static shell — no server features needed.
  reactStrictMode: true,

  // Inlined into the client bundle at build time (NEXT_PUBLIC_*). All three are
  // public facts about the deployed build — nothing secret.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_SHA: commitSha(),
    NEXT_PUBLIC_BUILD_DATE: commitDate(),
  },

  /**
   * Serve Firebase's auth handler from this app's own origin.
   *
   * Why: with the default `authDomain` (<project>.firebaseapp.com) the handler
   * is cross-origin, so Safari's storage partitioning breaks
   * `signInWithRedirect` — which is why this app used `signInWithPopup`. But a
   * popup cannot be relied on inside an INSTALLED PWA (standalone mode opens a
   * detached browser context and the handshake back to the app is lost), so
   * the home-screen app needs redirect to work.
   *
   * Proxying `/__/auth/*` makes the handler same-origin, which unblocks
   * redirect under ITP and in standalone. Applies in `next dev` too, so local
   * development behaves like production.
   */
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${AUTH_HANDLER_HOST}/__/auth/:path*`,
      },
    ];
  },

  /**
   * The four headers that cost nothing to be right about.
   *
   * Firestore's security rules are the only real boundary in this project —
   * there is no backend to defend — so these do not protect the data. What
   * they protect is the browser: a response mislabelled as HTML, a referrer
   * leaking a path to a third party, the app framed by someone else, a
   * permission prompt nobody asked for.
   *
   * NOT here, on purpose: Content-Security-Policy — and the reason is a
   * contradiction to resolve, not a chore to get around.
   *
   * Firebase Auth's handler is proxied through this origin (see rewrites
   * above), and `source: "/:path*"` below means these headers DO reach it:
   * curl `/__/auth/handler` and the X-Frame-Options here comes back on it. So
   * a CSP added here would govern a page this project does not author.
   *
   * That page (462 bytes) loads two relative scripts, which `'self'` covers
   * fine, and one INLINE script carrying `nonce="firebase-auth-helper"` —
   * a nonce Firebase chose, not us. Per CSP3, a `script-src` containing any
   * `nonce-` source makes `'unsafe-inline'` be ignored. So the moment anyone
   * writes the nonce-based policy — the only kind worth enforcing — that
   * inline script has no nonce we can emit, and sign-in breaks on the redirect
   * back from Google, which no local test reaches.
   *
   * The obvious escape hatch is worthless: allowlisting the literal
   * `'nonce-firebase-auth-helper'` works, but a constant, public nonce is
   * `'unsafe-inline'` with extra steps for anyone who can read the header.
   *
   * So the decision that comes FIRST is architectural — stop proxying the
   * handler, or accept `'unsafe-inline'` permanently — and it is not a
   * decision to make while writing a header. Measured on this origin and
   * independently by the Stock session, which ships the same rewrite WITH a
   * policy and hit the same wall from the other side (their `f8b2f83`).
   *
   * Two more things for whoever takes it. `connect-src` has to include the
   * EMULATOR hosts, and only when they are in use: Stock's report-only run
   * produced twelve violations, every one of them the emulator, and the
   * symptom is not an error anyone sees — it is Firestore never connecting and
   * a screen with nothing on it.
   *
   * And the moment a policy names a port, THIS FILE becomes a copy of
   * `firebase.json`. Concretely, so nobody has to rediscover it: adding the
   * CSP will make `apps/web/src/lib/emulator-ports.test.ts` fail on "knows
   * about every file that repeats a port", naming this file. The fix is to add
   * it to `COPIES` there with a check for the ports the policy allows — not to
   * add it to `accounted`, which would silence the failure without holding
   * anything. Stock shipped the policy first and got the failure pointed at
   * the wrong file for a while; this note is so we do not.
   *
   * X-Frame-Options does not affect sign-in: the handler is a top-level
   * navigation (popup or redirect), never an iframe.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
