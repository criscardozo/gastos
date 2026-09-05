"use client";

// What a render crash looks like.
//
// Without one of these Next.js shows its own screen: a stack trace, in English,
// on a black page. For an app whose every word is in Spanish that reads as
// somebody else's error — the kind you screenshot and ask "what is this?"
// about, rather than one you can act on.
//
// It says the two things that are useful: try again, and the data is safe.
// Both are true — nothing here writes on render, and Firestore already holds
// what was saved.
//
// Inline styles, not tokens or Tailwind classes, and no providers: this
// renders when something has ALREADY gone wrong, so it must not depend on the
// app's CSS having loaded or its context having mounted. The build stamp is
// what makes a screenshot of it worth anything a week later.

import { useEffect } from "react";

export function CrashScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The same prefix every listener in this codebase logs under, so one
    // filter in the console finds all of it.
    console.error("[gastos] render", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#FAF6EF",
        color: "#231A12",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: "360px", textAlign: "center" }}>
        <p style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 8px" }}>
          Algo se rompió
        </p>
        <p
          style={{
            fontSize: "14px",
            lineHeight: 1.5,
            margin: "0 0 20px",
            color: "#6B5D4F",
          }}
        >
          La pantalla no se pudo dibujar. Tus gastos están guardados — esto no
          los toca. Probá de nuevo, y si vuelve a pasar, cerrá y volvé a abrir
          la app.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            font: "inherit",
            fontSize: "15px",
            fontWeight: 700,
            color: "#FFFFFF",
            background: "#FF5C39",
            border: "none",
            borderRadius: "999px",
            padding: "13px 28px",
            cursor: "pointer",
            touchAction: "manipulation",
          }}
        >
          Reintentar
        </button>
        <p
          style={{
            fontSize: "11px",
            margin: "20px 0 0",
            color: "#9C8C7C",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {process.env.NEXT_PUBLIC_APP_VERSION} ·{" "}
          {process.env.NEXT_PUBLIC_BUILD_SHA}
          {error.digest !== undefined ? ` · ${error.digest}` : ""}
        </p>
      </div>
    </div>
  );
}
