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
};

export default nextConfig;
