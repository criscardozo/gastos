"use client";

// Which card is which — the four digits the bank prints, and what they mean.
//
// The bank's notification emails identify a card exactly one way ("finalizada
// en 1234"), and the ingestion stores those digits on every charge. Told which
// digits belong to the debit card and which to the credit one, the app can route
// a charge to the screen it belongs on instead of piling everything into expense
// verification.
//
// Nothing here is required: with no cards configured every charge is
// unidentified, which shows it in both places — the same behaviour the app had
// before this existed.

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { useAppError } from "@/components/app-error";
import { Segmented } from "@/components/ui/segmented";
import { CardMark } from "@/components/ui/marks";
import { getFirebaseClient } from "@/lib/firebase/client";
import { updateHouseholdCards } from "@/lib/firebase/mutations";
import type { Household } from "@/lib/firebase/converters";
import {
  MAX_CARDS,
  cardRows,
  isValidLast4,
  type CardKind,
  type HouseholdCards,
} from "@/lib/cards";
import { CARD_BRANDS, type CardBrand } from "@/lib/statements";

export function CardsCard({ household }: { household: Household }) {
  const { write } = useAppError();
  const t = useTranslations("cardsSettings");
  const tCommon = useTranslations("expenses");

  const [adding, setAdding] = useState(false);
  const [last4, setLast4] = useState("");
  const [kind, setKind] = useState<CardKind>("debit");
  const [brand, setBrand] = useState<CardBrand>("visa");

  const rows = cardRows(household.cards);
  const full = rows.length >= MAX_CARDS;
  // Four digits, and not one already taken.
  const valid = isValidLast4(last4) && household.cards[last4] === undefined;

  const save = (cards: HouseholdCards) => {
    const fb = getFirebaseClient();
    // Never awaited: Firestore resolves a write only on server ack.
    if (fb !== null) write(updateHouseholdCards(fb.db, household.id, cards));
  };

  const add = () => {
    if (!valid) return;
    save({
      ...household.cards,
      [last4]: kind === "credit" ? { kind, brand } : { kind },
    });
    setLast4("");
    setKind("debit");
    setAdding(false);
  };

  const remove = (digits: string) => {
    const next = { ...household.cards };
    delete next[digits];
    save(next);
  };

  const field =
    "w-24 rounded-xl border border-line bg-bg px-3 py-2 text-base text-ink outline-none focus:border-accent";

  return (
    // `tarjetas` is where Tarjetas' "not configured" note links to.
    <div
      id="tarjetas"
      className="flex scroll-mt-6 flex-col rounded-[18px] border border-line bg-surface px-[18px] py-4"
    >
      <div className="mb-1 flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="section-label">{t("title")}</span>
          <span className="tnum text-[11px] font-semibold text-ink-3">
            {rows.length}/{MAX_CARDS}
          </span>
        </div>
        <p className="text-[11px] leading-snug text-ink-3">{t("hint")}</p>
      </div>

      {rows.length > 0 && (
        <div className="divide-y divide-soft">
          {rows.map(({ last4: digits, card }) => (
            <div key={digits} className="flex items-center gap-3 py-2.5">
              <span className="tnum w-[62px] flex-none text-[14px] font-bold text-ink">
                ••{digits}
              </span>
              <span className="flex flex-1 items-center gap-2">
                <span className="text-[13px] font-semibold text-ink-2">
                  {t(card.kind)}
                </span>
                {card.kind === "credit" && card.brand !== undefined
                  && card.brand !== null && <CardMark brand={card.brand} size={26} />}
              </span>
              <button
                type="button"
                onClick={() => remove(digits)}
                aria-label={`${tCommon("delete")} ••${digits}`}
                className="rounded-lg p-1.5"
              >
                <Icon name="delete" size={16} className="text-ink-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="mt-2 flex flex-col gap-2.5 rounded-[14px] bg-fill px-3 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              autoFocus
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder="••••"
              aria-label={t("last4")}
              className={`${field} tnum`}
            />
            <Segmented
              options={[
                { value: "debit" as const, label: t("debit") },
                { value: "credit" as const, label: t("credit") },
              ]}
              value={kind}
              onChange={setKind}
            />
          </div>

          {/* The brand only matters for credit: it is what a charge turned into
              a card charge needs, and the bank's email never says it. */}
          {kind === "credit" && (
            <div className="flex items-center gap-2">
              {CARD_BRANDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={brand === value}
                  onClick={() => setBrand(value)}
                  className={`flex items-center justify-center rounded-xl border px-4 py-1.5 ${
                    brand === value
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-surface"
                  }`}
                >
                  <CardMark brand={value} size={28} />
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!valid}
              onClick={add}
              className="rounded-full bg-accent px-4 py-2 primary-disabled"
            >
              <span className="text-[13px] font-bold text-white">
                {tCommon("save")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setLast4("");
              }}
              className="px-2 py-2"
            >
              <span className="text-[13px] font-semibold text-ink-2">
                {tCommon("cancel")}
              </span>
            </button>
            {last4 !== "" && !valid && (
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--over)" }}>
                {household.cards[last4] !== undefined
                  ? t("duplicate")
                  : t("fourDigits")}
              </span>
            )}
          </div>
        </div>
      ) : (
        !full && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1 flex items-center gap-2 self-start py-1.5"
          >
            <Icon name="add_circle" size={17} className="text-accent-strong" />
            <span className="text-[13px] font-bold text-accent-strong">
              {t("add")}
            </span>
          </button>
        )
      )}
    </div>
  );
}
