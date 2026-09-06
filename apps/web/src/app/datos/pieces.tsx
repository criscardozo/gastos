"use client";

/**
 * The three controls the data screen is built from: the export menu, the
 * category filter and the sortable column header.
 *
 * Split out of page.tsx, which was 844 lines with these below the component
 * that used them. Nothing here changed.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";

/** Which column the grid is ordered by. */
export type SortKey = "date" | "category" | "note" | "amount" | "amountUsd";

export function ExportMenu({
  disabled,
  busy,
  blocked,
  unverifiedCount,
  acceptUnverified,
  onAcceptUnverified,
  onCsv,
  onPdf,
  onExcel,
  onDrive,
}: {
  disabled: boolean;
  busy: string;
  /** True while the unverified consent is still unticked. */
  blocked: boolean;
  unverifiedCount: number;
  acceptUnverified: boolean;
  onAcceptUnverified: (value: boolean) => void;
  onCsv: () => void;
  onPdf: () => void;
  onExcel: () => void;
  onDrive: () => void;
}) {
  const t = useTranslations("data");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  // Clicking OUTSIDE closes it. Decided by asking the DOM whether the click
  // landed inside this menu, not by stopping propagation on the way up:
  // React's synthetic handler runs at its own root, and a native listener on
  // `document` had already seen the event — which closed the menu the instant
  // the consent checkbox was ticked, before its own onChange could land.
  //
  // Registered only while open, so the app is not carrying a document listener
  // around for a menu nobody opened.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && root.current?.contains(target) === true) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  const items = [
    { key: "csv", label: t("exportCsv"), run: onCsv },
    { key: "pdf", label: t("exportPdf"), run: onPdf },
    {
      key: "excel",
      label: busy === "excel" ? t("exporting") : t("exportExcel"),
      run: onExcel,
    },
    {
      key: "drive",
      label: busy === "drive" ? t("exportingDrive") : t("exportDrive"),
      run: onDrive,
    },
  ];

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-pill bg-surface px-4 py-2 text-[13px] font-bold text-ink"
      >
        <Icon name="download" size={15} className="text-ink-2" />
        {t("exportTitle")}
        <Icon name="expand_more" size={16} className="text-ink-3" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 flex w-[260px] flex-col gap-1 rounded-[16px] border border-line bg-surface p-1.5 shadow-[0_12px_30px_rgba(0,0,0,.14)]"
        >
          {unverifiedCount > 0 && (
            <label className="m-0.5 flex items-start gap-2 rounded-[12px] bg-warn-bg px-3 py-2.5">
              <input
                type="checkbox"
                checked={acceptUnverified}
                onChange={(e) => onAcceptUnverified(e.target.checked)}
                className="mt-px size-4 flex-none accent-[var(--warn-text)]"
              />
              <span className="flex flex-col gap-px">
                <span className="text-[12px] font-bold text-warn-text">
                  {t("acceptUnverified")}
                </span>
                <span className="text-[11px] font-semibold text-warn-text opacity-80">
                  {t("unverifiedNotice", { count: unverifiedCount })}
                </span>
              </span>
            </label>
          )}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={disabled || blocked}
              onClick={() => {
                item.run();
                setOpen(false);
              }}
              className="flex items-center gap-2 rounded-[11px] px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-fill disabled:opacity-40"
            >
              <Icon name="download" size={14} className="text-ink-3" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The category filter that lives in its own column heading.
 *
 * Checkboxes rather than a `<select multiple>`: the native one needs
 * ctrl-clicking to add a second choice, shows its options in a fixed-height box
 * and has no notion of "all". This is a list you tick.
 */
export function CategoryFilter({
  available,
  selected,
  labelOf,
  onChange,
}: {
  available: readonly string[];
  /** null = every category, which is the default and what a new range resets to. */
  selected: string[] | null;
  labelOf: (id: string) => string;
  onChange: (next: string[] | null) => void;
}) {
  const t = useTranslations("data");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && root.current?.contains(target) === true) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  const isOn = (id: string) => selected === null || selected.includes(id);

  const toggle = (id: string) => {
    // Unticking one from "all" means "all except this one", which is the only
    // reading that makes the first click do something visible.
    const current = selected ?? [...available];
    const next = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id];
    // Back to everything ⇒ back to null, so a new range keeps working.
    onChange(next.length === available.length ? null : next);
  };

  const label =
    selected === null
      ? t("categoriesAll")
      : selected.length === 1
        ? labelOf(selected[0])
        : t("categoriesSome", { count: selected.length });

  return (
    <div className="relative inline-block" ref={root}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        // Not "Categoría": the sort control in the same heading is already
        // called that, and two buttons with one name is a coin toss.
        aria-label={t("filterCategory")}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-0.5 rounded-[8px] border bg-bg px-1.5 py-0.5 text-[11.5px] font-semibold ${
          selected === null
            ? "border-pill text-ink-3"
            : "border-accent text-accent-strong"
        }`}
      >
        {label}
        <Icon name="expand_more" size={13} />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 flex w-[200px] flex-col gap-0.5 rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_12px_30px_rgba(0,0,0,.14)]">
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={selected === null}
            className="rounded-[10px] px-2.5 py-1.5 text-left text-[12.5px] font-bold text-accent-strong hover:bg-fill disabled:text-ink-3"
          >
            {t("categoriesAll")}
          </button>
          {available.map((id) => (
            <label
              key={id}
              className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-fill"
            >
              <input
                type="checkbox"
                checked={isOn(id)}
                onChange={() => toggle(id)}
                className="size-3.5 flex-none accent-[var(--accent)]"
              />
              {labelOf(id)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** A column heading that sorts. Clicking the active one flips the direction. */
export function SortHeader({
  label,
  columnKey,
  sortKey,
  sortAsc,
  onSort,
  align = "left",
}: {
  label: string;
  columnKey: SortKey;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === columnKey;
  return (
    <th
      className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : ""}`}
      // The one attribute that tells a screen reader the table is sorted at
      // all, and by which column.
      aria-sort={active ? (sortAsc ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`inline-flex items-center gap-1 ${
          active ? "text-ink" : "text-ink-3"
        }`}
      >
        {label}
        <Icon
          name={active && !sortAsc ? "keyboard_arrow_down" : "keyboard_arrow_up"}
          size={14}
          className={active ? "text-accent-strong" : "text-transparent"}
        />
      </button>
    </th>
  );
}
