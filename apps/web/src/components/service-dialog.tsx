"use client";

// Add or edit a recurring bill.
//
// The one non-obvious field is the anchor month: a monthly service falls due
// every month, so there is nothing to anchor and the field is hidden (and the
// rules reject it outright). Anything less frequent needs to know WHICH month,
// so it appears the moment the interval changes.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { Segmented } from "@/components/ui/segmented";
import { CurrencyTag } from "@/components/ui/marks";
import type { ServiceDoc } from "@/lib/firebase/converters";
import type { ServiceInput } from "@/lib/firebase/mutations";
import { formatCents, parseAmountToCents } from "@/lib/money";
import {
  SERVICE_INTERVALS,
  nextDueDate,
  type PaidWith,
  type ServiceInterval,
} from "@/lib/services";
import { formatLongDateInYear } from "@/lib/dates";

/** Integer cents back to an editable string ("2299" → "22,99"). */
function centsToInput(cents: number | null, locale: string): string {
  if (cents === null) return "";
  return formatCents(cents, "AUD", locale).replace(/[^\d.,]/g, "");
}

export function ServiceDialog({
  service,
  locale,
  today,
  onSave,
  onDelete,
  onClose,
}: {
  /** Null when adding. */
  service: ServiceDoc | null;
  locale: string;
  today: string;
  onSave: (input: ServiceInput) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const t = useTranslations("services");
  const tCommon = useTranslations("expenses");

  const [name, setName] = useState(service?.name ?? "");
  const [aud, setAud] = useState(centsToInput(service?.amountAudCents ?? null, locale));
  const [usd, setUsd] = useState(centsToInput(service?.amountUsdCents ?? null, locale));
  const [interval, setInterval] = useState<ServiceInterval>(
    service?.interval ?? "monthly",
  );
  const [dueDay, setDueDay] = useState(String(service?.dueDay ?? 1));
  const [anchorMonth, setAnchorMonth] = useState(
    String(service?.anchorMonth ?? Number(today.slice(5, 7))),
  );
  const [paidWith, setPaidWith] = useState<PaidWith>(service?.paidWith ?? "debit");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const audCents = parseAmountToCents(aud, locale);
  const usdCents = parseAmountToCents(usd, locale);
  const day = Number(dueDay);
  const dayValid = Number.isInteger(day) && day >= 1 && day <= 31;
  // At least one price: a row with neither says nothing, and the rules agree.
  const valid =
    name.trim() !== "" && dayValid && (audCents !== null || usdCents !== null);

  const preview = dayValid
    ? nextDueDate(
        {
          interval,
          dueDay: day,
          anchorMonth: interval === "monthly" ? null : Number(anchorMonth),
        },
        today,
      )
    : null;

  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-AU", {
      month: "long",
    }).format(new Date(Date.UTC(2026, i, 1))),
  );

  const submit = () => {
    if (!valid) return;
    onSave({
      name: name.trim(),
      amountAudCents: audCents,
      amountUsdCents: usdCents,
      interval,
      dueDay: day,
      anchorMonth: interval === "monthly" ? null : Number(anchorMonth),
      paidWith,
    });
  };

  const field =
    "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={service === null ? t("add") : t("edit")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[440px] flex-col gap-3.5 overflow-y-auto rounded-t-[24px] border border-line bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[24px]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">
            {service === null ? t("add") : t("edit")}
          </h2>
          <button type="button" onClick={onClose} aria-label={tCommon("cancel")}>
            <Icon name="expand_more" size={22} className="text-ink-3" />
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("name")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={80}
            className={field}
          />
        </label>

        {/* Both currencies, both typed — the app converts neither into the
            other, so either may be left blank. */}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <CurrencyTag currency="AUD" />
            <input
              value={aud}
              onChange={(e) => setAud(e.target.value)}
              inputMode="decimal"
              placeholder="—"
              className={`${field} tnum`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <CurrencyTag currency="USD" />
            <input
              value={usd}
              onChange={(e) => setUsd(e.target.value)}
              inputMode="decimal"
              placeholder="—"
              className={`${field} tnum`}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="section-label">{t("interval")}</span>
          {/* Explicit aria-label: a <label> wrapping a <select> takes its
              accessible name from the label's whole text content, which
              includes every option — so the name would be "Frecuencia" plus
              the five interval names run together. */}
          <select
            aria-label={t("interval")}
            value={interval}
            onChange={(e) => setInterval(e.target.value as ServiceInterval)}
            className={field}
          >
            {SERVICE_INTERVALS.map((value) => (
              <option key={value} value={value}>
                {t(`intervals.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="section-label">{t("dueDay")}</span>
            <input
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={2}
              className={`${field} tnum`}
            />
          </label>
          {interval !== "monthly" && (
            <label className="flex flex-col gap-1.5">
              <span className="section-label">{t("anchorMonth")}</span>
              <select
                aria-label={t("anchorMonth")}
                value={anchorMonth}
                onChange={(e) => setAnchorMonth(e.target.value)}
                className={field}
              >
                {monthNames.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="section-label">{t("paidWith")}</span>
          <Segmented
            stretch
            size="lg"
            options={[
              { value: "debit" as const, label: t("debit") },
              { value: "credit" as const, label: t("credit") },
            ]}
            value={paidWith}
            onChange={setPaidWith}
          />
        </div>

        {/* The rule, spelled out as a date, so nobody has to trust the maths. */}
        {preview !== null && (
          <p className="text-[12px] text-ink-3">
            {t("nextDue", { date: formatLongDateInYear(preview, today, locale) })}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2.5">
          <button
            type="button"
            disabled={!valid}
            onClick={submit}
            className="flex-1 rounded-full bg-accent py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            {tCommon("save")}
          </button>
          {onDelete !== null && (
            <button
              type="button"
              onClick={() => {
                if (confirmDelete) onDelete();
                else setConfirmDelete(true);
              }}
              className="rounded-full border border-line px-4 py-3 text-sm font-semibold"
              style={{ color: "var(--over)" }}
            >
              {confirmDelete ? t("confirmDelete") : tCommon("delete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
