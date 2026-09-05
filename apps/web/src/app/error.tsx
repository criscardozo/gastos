"use client";

// A crash inside a page. Renders INSIDE the root layout, so no <html> here —
// that is global-error.tsx's job, for when the layout itself is what broke.

import { CrashScreen } from "@/components/crash-screen";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <CrashScreen {...props} />;
}
