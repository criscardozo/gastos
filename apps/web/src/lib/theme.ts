"use client";

// Manual theme preference (per-device, localStorage). "system" follows the
// OS via the @media (prefers-color-scheme) token block in globals.css;
// "light"/"dark" force the tokens via html[data-theme]. A tiny inline script
// in layout.tsx applies the stored value before first paint (no flash).

export type ThemePref = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "gd:theme";

/** Page background colors, mirrored from the tokens in globals.css. */
const THEME_COLORS = { light: "#FAF6EF", dark: "#191410" } as const;

export function readStoredTheme(): ThemePref {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(pref: ThemePref): void {
  try {
    if (pref === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    }
  } catch {
    // Storage unavailable — the preference just won't persist.
  }
}

/** Apply the preference to <html data-theme> and <meta name="theme-color">. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", pref);
  }
  // The viewport metas carry prefers-color-scheme media queries; when a
  // theme is forced, both must show the forced color so the browser chrome
  // matches regardless of the system theme.
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      const systemColor = meta.media.includes("dark")
        ? THEME_COLORS.dark
        : THEME_COLORS.light;
      meta.content = pref === "system" ? systemColor : THEME_COLORS[pref];
    });
}
