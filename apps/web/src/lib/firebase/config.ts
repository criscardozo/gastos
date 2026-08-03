// Firebase client configuration. These values are PUBLIC by design — the
// Firestore security rules are the security boundary, not this config.
// Each value can be overridden via NEXT_PUBLIC_FIREBASE_* env vars (Vercel).

/** Firebase's own auth domain — the fallback when we can't serve the handler
 * ourselves (server render, or a host without the proxy). */
const FIREBASE_AUTH_DOMAIN = "qcris-gastos-diarios.firebaseapp.com";

/**
 * Where Firebase's auth handler lives, from the browser's point of view.
 *
 * next.config.ts proxies `/__/auth/*` to Firebase, so ANY host serving this
 * app also serves the handler on its own origin. Reporting that origin as the
 * authDomain is what makes `signInWithRedirect` survive Safari's storage
 * partitioning — and redirect is the only flow an installed PWA can rely on.
 * Falls back to Firebase's domain during SSR/prerender, where there is no
 * window (auth only ever runs client-side).
 */
function resolveAuthDomain(): string {
  const explicit = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  if (explicit !== undefined && explicit !== "") return explicit;
  if (typeof window === "undefined") return FIREBASE_AUTH_DOMAIN;
  // Firebase always builds the handler URL as https://<authDomain>/__/auth/…
  // — there is no way to make it http. So over a plain-http origin (the local
  // dev server) pointing it at ourselves yields https://localhost:3000/…,
  // which fails with ERR_SSL_PROTOCOL_ERROR. Fall back to Firebase's own
  // domain there; localhost is an authorised domain out of the box, and the
  // same-origin proxy is only needed on the deployed HTTPS site anyway.
  if (window.location.protocol !== "https:") return FIREBASE_AUTH_DOMAIN;
  return window.location.host;
}

export const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    "AIzaSyCFjRzCIzkg3Lkh44J1UxwNV1w9EBbMX6s",
  authDomain: resolveAuthDomain(),
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "qcris-gastos-diarios",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "qcris-gastos-diarios.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "56331687585",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:56331687585:web:85445c77bb34f8048682e0",
};

export const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
