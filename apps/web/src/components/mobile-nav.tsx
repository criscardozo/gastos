"use client";

// Bottom tab bar — the phone counterpart of the desktop sidebar, mirroring the
// iOS app's navigation. Hidden from `lg` up, where the sidebar takes over.
// Sits above the home indicator via the safe-area inset.
//
// DEPRECATED with the rest of the PWA since 2026-09-24, by Cristian's decision:
// kept, not maintained. The known defects of this layout are listed in the
// root CLAUDE.md, next to the PWA line — read that before "fixing" anything
// here.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";

// Eight entries share 390px on the smallest phone this app targets, i.e. ~48px
// each. Every label fits in that except "Estadísticas" (57px), which is why it
// carries a short form used HERE ONLY — the sidebar, which has room, keeps the
// full word. Measured, not guessed: at 10.5px the labels were touching.
const TABS = [
  { href: "/nuevo", icon: "add_circle", key: "new" },
  { href: "/", icon: "donut_small", key: "summary" },
  { href: "/gastos", icon: "receipt_long", key: "expenses" },
  { href: "/servicios", icon: "calendar_today", key: "services" },
  { href: "/tarjetas", icon: "credit_card", key: "cards" },
  { href: "/estadisticas", icon: "bar_chart", key: "statsShort" },
  { href: "/datos", icon: "database", key: "data" },
  { href: "/ajustes", icon: "settings", key: "settings" },
] as const;

export function MobileNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label={t("summary")}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-2"
          >
            <Icon
              name={tab.icon}
              size={22}
              className={active ? "text-accent-strong" : "text-ink-3"}
            />
            {/* min-w-0 + truncate: a label can never bleed into its neighbour,
                whatever a future translation does to its length. */}
            <span
              className={`max-w-full truncate text-[10.5px] ${
                active ? "font-bold text-accent-strong" : "font-semibold text-ink-3"
              }`}
            >
              {t(tab.key)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
