"use client";

// Google sign-in, with the flow chosen by how the app is being displayed.
//
// Browser tab  → popup: it keeps the user on the page and is unaffected by
//                Safari's storage partitioning.
// Installed PWA → redirect: `window.open` in standalone mode opens a detached
//                browser context, and the popup's handshake back to the app
//                is unreliable — the user gets stuck on a blank screen.
//
// Redirect only works because next.config.ts proxies `/__/auth/*`, making
// Firebase's auth handler same-origin (see config.ts). If a popup fails for
// any reason we fall back to redirect rather than dead-ending the user.

import {
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
  type AuthProvider,
} from "firebase/auth";

/** True when running as an installed app (iOS home screen, or any browser's
 * installed-PWA mode) rather than in a normal browser tab. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari predates the standard and only exposes navigator.standalone.
  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  if (iosStandalone === true) return true;
  return (
    typeof window.matchMedia === "function" &&
    ["standalone", "fullscreen", "minimal-ui"].some(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
    )
  );
}

/**
 * Starts Google sign-in. Resolves once signed in (popup) or never returns
 * because the page navigated away (redirect). Throws only when sign-in
 * genuinely failed and there is nothing left to try.
 */
export async function signInWithGoogle(
  auth: Auth,
  provider: AuthProvider,
): Promise<void> {
  if (isStandaloneDisplay()) {
    await signInWithRedirect(auth, provider);
    return;
  }
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (isUserCancelled(error)) throw error;
    // Popup blocked or unusable in this context — redirect instead.
    await signInWithRedirect(auth, provider);
  }
}

/** Closing the popup is a deliberate choice, not a failure to route around. */
function isUserCancelled(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  );
}

/**
 * Completes a redirect sign-in when the app reloads after coming back from
 * Google. `onAuthStateChanged` already picks up the session, so this exists to
 * surface an error that would otherwise be swallowed. Returns true when a
 * redirect sign-in completed successfully.
 */
export async function completeRedirectSignIn(auth: Auth): Promise<boolean> {
  const result = await getRedirectResult(auth);
  return result !== null;
}
