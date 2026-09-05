import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";

import "./globals.css";

import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegistrar } from "@/components/service-worker";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "Gastos Diarios",
  description: "El presupuesto de la casa, entre los dos.",
  // Installed-app behaviour on iOS. The manifest covers modern iOS, but the
  // legacy meta tags still matter on older versions.
  appleWebApp: {
    capable: true,
    title: "Gastos",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF6EF" },
    { media: "(prefers-color-scheme: dark)", color: "#191410" },
  ],
  // Extend under the notch and the home indicator; every edge the content
  // must avoid is then handled explicitly via env(safe-area-inset-*).
  viewportFit: "cover",
  // `maximumScale: 1` used to live here, and the reasoning was half right: an
  // accidental double-tap zoom during quick entry IS pure friction. But the
  // price was pinch-to-zoom for everybody, which is the one gesture somebody
  // who cannot read a 12px label depends on — and the browser is entitled to
  // ignore the cap anyway. The narrow tool is `touch-action: manipulation` on
  // the things that get double-tapped (globals.css): it kills the double-tap
  // and leaves the pinch.
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={outfit.variable}>
      <body className="font-sans antialiased">
        {/* Apply the stored manual theme BEFORE first paint (blocking inline
            script as the first body node) so a forced light/dark never
            flashes the system theme. Key must match THEME_STORAGE_KEY. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("gd:theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();',
          }}
        />
        <ServiceWorkerRegistrar />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
