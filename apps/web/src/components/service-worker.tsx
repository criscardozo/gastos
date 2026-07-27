"use client";

// Registers the service worker that makes the installed PWA work offline.
// Renders nothing. Skipped in development (a stale SW caching dev assets is
// pure confusion) and on browsers without support — the app then behaves
// exactly as it did before, just without offline start.

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline support is a bonus; never surface this to the user.
      });
    };

    // Registering after load keeps the SW off the critical path of the first
    // paint (it competes for bandwidth with the app chunks otherwise).
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
