"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { AvatarPair } from "@/components/ui/avatar";
import { PiggyMark } from "@/components/brand";
import { useHousehold } from "@/components/providers";

const NAV = [
  { href: "/nuevo", icon: "add_circle", key: "new" },
  { href: "/", icon: "donut_small", key: "summary" },
  { href: "/gastos", icon: "receipt_long", key: "expenses" },
  { href: "/datos", icon: "database", key: "data" },
  { href: "/ajustes", icon: "settings", key: "settings" },
] as const;

export function Sidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { household } = useHousehold();

  const members =
    household !== null
      ? household.memberIds
          .map((id) => household.memberProfiles[id])
          .filter((p) => p !== undefined)
          .map((p) => ({ name: p.displayName, color: p.color }))
      : [];

  return (
    <aside className="hidden w-[232px] flex-none flex-col gap-1.5 border-r border-line px-4 py-[22px] lg:flex">
      <div className="mb-[22px] flex items-center gap-2.5 px-2">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[11px] bg-accent">
          <PiggyMark size={24} variant="cream" />
        </div>
        <span className="text-base font-bold text-ink">Gastos Diarios</span>
      </div>

      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${
              active ? "bg-accent-soft" : "hover:bg-fill"
            }`}
          >
            <Icon
              name={item.icon}
              size={19}
              className={active ? "text-accent-strong" : "text-ink-2"}
            />
            <span
              className={`text-sm ${
                active
                  ? "font-bold text-accent-strong"
                  : "font-semibold text-ink-2"
              }`}
            >
              {t(item.key)}
            </span>
          </Link>
        );
      })}

      {household !== null && (
        <div className="mt-auto flex items-center gap-2.5 rounded-[14px] border border-line bg-surface px-3 py-2.5">
          <AvatarPair members={members} size={28} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px] font-bold text-ink">
              {household.name}
            </span>
            <span className="text-[11px] text-ink-3">
              {t("sharedHousehold")}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
