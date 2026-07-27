import type { NextConfig } from "next";

// Firebase's hosted auth handler, proxied below so it is served from OUR
// origin. Overridable for a different project.
const AUTH_HANDLER_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST ??
  "qcris-gastos-diarios.firebaseapp.com";

const nextConfig: NextConfig = {
  // Fully client-rendered app behind a static shell — no server features needed.
  reactStrictMode: true,

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
