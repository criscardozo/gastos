"use client";

// A crash in the ROOT LAYOUT — the providers, the fonts, the shell. This
// replaces the whole document, which is why it is the one that must render
// <html> and <body> itself.

import { CrashScreen } from "@/components/crash-screen";

export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body style={{ margin: 0 }}>
        <CrashScreen {...props} />
      </body>
    </html>
  );
}
