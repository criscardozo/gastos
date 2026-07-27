"use client";

// Bottom tab bar — the phone counterpart of the desktop sidebar, mirroring the
// iOS app's navigation. Hidden from `lg` up, where the sidebar takes over.
// Sits above the home indicator via the safe-area inset.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";

const TABS = [
  { href: "/nuevo", icon: "add_circle", key: "new" },
  { href: "/", icon: "donut_small", key: "summary" },
  { href: "/gastos", icon: "receipt_long", key: "expenses" },
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
            className="flex flex-1 flex-col items-center gap-0.5 py-2"
          >
            <Icon
              name={tab.icon}
              size={22}
              className={active ? "text-accent-strong" : "text-ink-3"}
            />
            <span
              className={`text-[10.5px] ${
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
