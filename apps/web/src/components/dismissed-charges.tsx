"use client";

// The charges discarded in the last 48 hours, and the way back.
//
// Discarding is a single press with no confirmation, which is right — it is the
// common case and prompting every time would be worse. What makes that safe is
// this list: a dismissal is a stamp, not a delete, so for 48 hours it can be
// taken back. Past the window the sweep in useBankCharges removes them.
//
// Rendered by both inboxes (expense verification and Tarjetas), each passing
// only its own subset, so a restored charge reappears exactly where the person
// looking for it is already looking.

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import type { BankChargeDoc } from "@/lib/firebase/converters";
import { formatUsd } from "@/lib/money";
import { formatShortDate } from "@/lib/dates";
import { displayMerchant } from "@/lib/merchant-name";

export function DismissedCharges({
  charges,
  onRestore,
  locale,
}: {
  /** Already filtered to the window and to this screen's cards. */
  charges: BankChargeDoc[];
  onRestore: (chargeId: string) => void;
  locale: string;
}) {
  const t = useTranslations("bankDismissed");
  const [open, setOpen] = useState(false);

  if (charges.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-soft pt-2.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 self-start py-0.5"
      >
        {/* Rotated rather than swapped: the icon set has no expand_less. */}
        <Icon
          name="expand_more"
          size={15}
          className={`text-ink-3 ${open ? "rotate-180" : ""}`}
        />
        <span className="text-[11.5px] font-semibold text-ink-3">
          {t("summary", { count: charges.length })}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] leading-snug text-ink-3">{t("hint")}</p>
          {charges.map((charge) => (
            <div key={charge.id} className="flex items-center gap-3 py-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="tnum text-[13px] font-bold text-ink-2">
                  {formatUsd(charge.usdCents, locale)}
                </span>
                <span className="truncate text-[11px] text-ink-3">
                  {formatShortDate(charge.date, locale)}
                  {charge.merchant !== "" && ` · ${displayMerchant(charge.merchant)}`}
                  {charge.cardLast4 !== null && ` · ••${charge.cardLast4}`}
                </span>
              </div>
              <button
                type="button"
                // Named after the charge: three identical "Restaurar" buttons
                // tell a screen reader nothing about which one it is on.
                aria-label={`${t("restore")} ${formatUsd(charge.usdCents, locale)}`}
                onClick={() => onRestore(charge.id)}
                className="rounded-full border border-pill bg-surface px-3 py-1.5"
              >
                <span className="text-[12px] font-bold text-ink">
                  {t("restore")}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
