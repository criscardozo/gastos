"use client";

// Importing expenses from a CSV that matches the app's own export format.
//
// Lives in Ajustes rather than on the Datos screen, which is now for LOOKING at
// what is there. Importing is a rare, one-way act — it writes rows nothing
// undoes in bulk — and it sat next to four export buttons where the only thing
// distinguishing them was the word.
//
// Writes go through a chunked writeBatch matching the exact expense field set
// the security rules validate.

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";

import { useAuth, useHousehold, useLocale } from "@/components/providers";
import { Icon } from "@/components/ui/icon";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  formatCents,
  formatUsd,
  MAX_AMOUNT_CENTS,
  parseAmountToCents,
} from "@/lib/money";
import { parseCsv } from "@/lib/export/csv";

/** Case- and diacritic-insensitive fold for category/header matching. */
function fold(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** True for a well-formed AND real "YYYY-MM-DD" calendar date. */
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

interface PreviewRow {
  rawDate: string;
  rawCategory: string;
  note: string;
  rawAmount: string;
  date: string;
  categoryId: string;
  amountCents: number | null;
  /** The bank's USD charge from the optional `monto_usd` column. */
  usdCents: number | null;
  status: "ok" | "mapped" | "error";
  reasonKey?: "reasonBadDate" | "reasonBadAmount" | "reasonBadUsd";
}

// Amount cap mirrors the security rule (1..10_000_000 cents).
const MAX_NOTE_LEN = 200;
const BATCH_CHUNK = 400;

export function ImportExpenses() {
  const t = useTranslations("data");
  const tCat = useTranslations("categories");
  const { locale } = useLocale();
  const { user } = useAuth();
  const { household } = useHousehold();

  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [headerError, setHeaderError] = useState(false);
  const [fileError, setFileError] = useState(false);
  const [importPhase, setImportPhase] = useState<
    "idle" | "working" | "done" | "error"
  >("idle");
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* Localized category list + lookup maps (before any early return — hooks
     cannot be conditional). */
  const categories = useMemo(() => {
    if (household === null) return [] as { id: string; label: string }[];
    return Object.entries(household.categories)
      .map(([id, def]) => ({
        id,
        label: def.key !== undefined ? tCat(def.key) : (def.name ?? id),
        sortOrder: def.sortOrder,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ id, label }) => ({ id, label }));
  }, [household, tCat]);

  const catLabelOf = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.label]));
    return (id: string): string => map.get(id) ?? tCat("deleted");
  }, [categories, tCat]);

  // Fold map: both localized labels and ids resolve to an id (ids win).
  const matchCategory = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(fold(c.label), c.id);
    for (const c of categories) map.set(fold(c.id), c.id);
    return (value: string): string | null => map.get(fold(value)) ?? null;
  }, [categories]);

  if (household === null || user === null) return null;

  const buildPreview = (grid: string[][]): PreviewRow[] | null => {
    // Drop fully-empty rows (blank lines).
    const nonEmpty = grid.filter((r) => r.some((c) => c.trim() !== ""));
    if (nonEmpty.length === 0) return null;
    const header = nonEmpty[0];
    // Unknown columns are ignored, so files exported by older versions (which
    // carried `moneda`/`monto_original`) still import from their monto_aud.
    // `monto_usd` is optional: filled ⇒ the row imports already verified.
    const idx = { date: -1, category: -1, note: -1, amount: -1, usd: -1 };
    header.forEach((cell, i) => {
      const f = fold(cell);
      if (f === "fecha") idx.date = i;
      else if (f === "categoria") idx.category = i;
      else if (f === "nota") idx.note = i;
      else if (f === "monto_aud") idx.amount = i;
      else if (f === "monto_usd") idx.usd = i;
    });
    if (idx.date < 0 || idx.category < 0 || idx.amount < 0) return null;

    const out: PreviewRow[] = [];
    for (const cells of nonEmpty.slice(1)) {
      const rawDate = (cells[idx.date] ?? "").trim();
      const rawCategory = (cells[idx.category] ?? "").trim();
      const rawAmount = (cells[idx.amount] ?? "").trim();
      const rawUsd = (idx.usd >= 0 ? (cells[idx.usd] ?? "") : "").trim();
      const note = (idx.note >= 0 ? (cells[idx.note] ?? "") : "")
        .trim()
        .slice(0, MAX_NOTE_LEN);

      const dateOk = isRealDate(rawDate);
      const parsed = parseAmountToCents(rawAmount, locale);
      const amountOk = parsed !== null && parsed <= MAX_AMOUNT_CENTS;

      // An empty monto_usd is normal (unverified); a filled one must be a real
      // positive amount, since it is what makes the row verified.
      const parsedUsd = rawUsd === "" ? null : parseAmountToCents(rawUsd, locale);
      const usdOk =
        rawUsd === "" ||
        (parsedUsd !== null && parsedUsd <= MAX_AMOUNT_CENTS);

      const matched = matchCategory(rawCategory);
      const categoryId = matched ?? "other";

      let status: PreviewRow["status"];
      let reasonKey: PreviewRow["reasonKey"];
      if (!dateOk) {
        status = "error";
        reasonKey = "reasonBadDate";
      } else if (!amountOk) {
        status = "error";
        reasonKey = "reasonBadAmount";
      } else if (!usdOk) {
        status = "error";
        reasonKey = "reasonBadUsd";
      } else if (matched === null) {
        status = "mapped";
      } else {
        status = "ok";
      }

      out.push({
        rawDate,
        rawCategory,
        note,
        rawAmount,
        date: rawDate,
        categoryId,
        amountCents: amountOk ? parsed : null,
        usdCents: usdOk ? parsedUsd : null,
        status,
        reasonKey,
      });
    }
    return out;
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setImportPhase("idle");
    setImportedCount(0);
    setFileError(false);
    setHeaderError(false);
    setPreview(null);
    try {
      const text = await file.text();
      const grid = parseCsv(text);
      const built = buildPreview(grid);
      if (built === null) {
        setHeaderError(true);
        return;
      }
      setPreview(built);
    } catch {
      setFileError(true);
    }
  };

  const importable = preview?.filter((r) => r.status !== "error") ?? [];
  const errorCount = (preview?.length ?? 0) - importable.length;

  const doImport = async () => {
    const fb = getFirebaseClient();
    if (fb === null || importable.length === 0) return;
    setImportPhase("working");
    try {
      for (let i = 0; i < importable.length; i += BATCH_CHUNK) {
        const batch = writeBatch(fb.db);
        for (const r of importable.slice(i, i + BATCH_CHUNK)) {
          const ref = doc(
            collection(fb.db, "households", household.id, "expenses"),
          );
          batch.set(ref, {
            amountCents: r.amountCents as number,
            categoryId: r.categoryId,
            note: r.note,
            date: r.date,
            createdBy: user.uid,
            // A row that carries the bank's USD imports already verified; the
            // rules need the pair to move together, so both keys or neither.
            ...(r.usdCents !== null
              ? { usdCents: r.usdCents, verified: true }
              : { verified: false }),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      setImportedCount(importable.length);
      setImportPhase("done");
      setPreview(null);
      if (fileInputRef.current !== null) fileInputRef.current.value = "";
    } catch {
      setImportPhase("error");
    }
  };

  const statusBadge = (r: PreviewRow) => {
    const styles: Record<PreviewRow["status"], string> = {
      ok: "bg-good-bg text-good-text",
      mapped: "bg-warn-bg text-warn-text",
      error: "bg-over-bg text-over-text",
    };
    const label =
      r.status === "ok"
        ? t("statusOk")
        : r.status === "mapped"
          ? t("statusMapped")
          : `${t("statusError")}: ${r.reasonKey ? t(r.reasonKey) : ""}`;
    return (
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${styles[r.status]}`}
      >
        {label}
      </span>
    );
  };

  return (
      <div className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-surface px-[18px] py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent-soft">
            <Icon name="database" size={17} className="text-accent-strong" />
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] font-bold text-ink">
              {t("importTitle")}
            </span>
            <span className="text-xs text-ink-3">{t("importHint")}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e)}
            aria-label={t("chooseFile")}
            className="block max-w-full text-[13px] text-ink-2 file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-pill file:bg-fill file:px-4 file:py-2 file:text-[13px] file:font-bold file:text-ink"
          />
        </div>

        {fileError && (
          <p className="text-[13px] font-semibold text-over-text">{t("fileError")}</p>
        )}
        {headerError && (
          <p className="text-[13px] font-semibold text-over-text">
            {t("reasonNoColumns")}
          </p>
        )}

        {preview !== null && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="section-label">{t("preview")}</span>
              <span className="text-[13px] font-semibold text-ink-2">
                {t("previewSummary", {
                  importable: importable.length,
                  errors: errorCount,
                })}
              </span>
            </div>

            {/* Dedup warning */}
            <div className="flex items-start gap-2 rounded-xl bg-warn-bg px-3 py-2.5">
              <Icon
                name="flag"
                size={15}
                style={{ color: "var(--warn-text)" }}
                className="mt-0.5 flex-none"
              />
              <span className="text-xs font-semibold text-warn-text">
                {t("dedupeWarning")}
              </span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-soft text-ink-3">
                    <th className="px-3 py-2 font-semibold">{t("colDate")}</th>
                    <th className="px-3 py-2 font-semibold">
                      {t("colCategory")}
                    </th>
                    <th className="px-3 py-2 font-semibold">{t("colNote")}</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      {t("colAmount")}
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      {t("colAmountUsd")}
                    </th>
                    <th className="px-3 py-2 font-semibold">{t("colStatus")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-soft">
                  {preview.map((r, i) => (
                    <tr key={i}>
                      <td className="tnum px-3 py-2 text-ink">{r.rawDate}</td>
                      <td className="px-3 py-2 text-ink">
                        {r.status === "mapped"
                          ? `${r.rawCategory || "—"} → ${catLabelOf("other")}`
                          : r.rawCategory || "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-ink-2">
                        {r.note || "—"}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-semibold text-ink">
                        {r.amountCents !== null
                          ? formatCents(
                              r.amountCents,
                              household.currency,
                              locale,
                            )
                          : r.rawAmount || "—"}
                      </td>
                      <td className="tnum px-3 py-2 text-right text-ink-3">
                        {r.usdCents !== null ? formatUsd(r.usdCents, locale) : "—"}
                      </td>
                      <td className="px-3 py-2">{statusBadge(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13px] font-semibold">
                {importPhase === "done" && (
                  <span className="text-good-text">
                    {t("importDone", { count: importedCount })}
                  </span>
                )}
                {importPhase === "error" && (
                  <span className="text-over-text">{t("importError")}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void doImport()}
                disabled={importable.length === 0 || importPhase === "working"}
                className="rounded-full bg-accent px-5 py-2 text-[13px] font-bold text-white disabled:opacity-40"
              >
                {importPhase === "working"
                  ? t("importing")
                  : t("importButton", { count: importable.length })}
              </button>
            </div>
          </div>
        )}

        {preview === null && importPhase === "done" && (
          <p className="text-[13px] font-semibold text-good-text">
            {t("importDone", { count: importedCount })}
          </p>
        )}
      </div>
  );
}
