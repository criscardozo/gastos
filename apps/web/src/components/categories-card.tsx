"use client";

// Settings card: manage the household categories map (list, rename inline,
// add with color + icon pickers, reorder with up/down, delete). Every write
// goes through updateHouseholdCategories (member update branch of the rules).
// Renaming a SEED category drops its translatable `key` and stores a literal
// `name` (shared/schema.md display rule: key ? t(key) : name).

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/icon";
import { getFirebaseClient } from "@/lib/firebase/client";
import { updateHouseholdCategories } from "@/lib/firebase/mutations";
import { countsToBudget } from "@/lib/categories";
import type { Household } from "@/lib/firebase/converters";
import {
  categoryCircleBg,
  categoryColor,
  CATEGORY_ICONS,
  CATEGORY_PALETTE,
  MAX_CATEGORIES,
  newCategoryId,
  type CategoryDef,
} from "@/lib/categories";

interface Row {
  id: string;
  def: CategoryDef;
  label: string;
}

function IconButton({
  name,
  ariaLabel,
  disabled,
  onClick,
}: {
  name: string;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[28px] w-[28px] items-center justify-center rounded-[9px] hover:bg-fill disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={name} size={15} className="text-ink-2" />
    </button>
  );
}

export function CategoriesCard({ household }: { household: Household }) {
  const t = useTranslations("categoryManager");
  const tCat = useTranslations("categories");

  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CATEGORY_PALETTE[0]);
  const [newIcon, setNewIcon] = useState(CATEGORY_ICONS[0]);

  const rows: Row[] = useMemo(
    () =>
      Object.entries(household.categories)
        .map(([id, def]) => ({
          id,
          def,
          label: def.key !== undefined ? tCat(def.key) : (def.name ?? id),
        }))
        .sort((a, b) => a.def.sortOrder - b.def.sortOrder),
    [household, tCat],
  );

  const atCap = rows.length >= MAX_CATEGORIES;

  const write = async (
    changes: Record<string, CategoryDef | null>,
  ): Promise<void> => {
    const fb = getFirebaseClient();
    if (fb === null) return;
    setSaving(true);
    try {
      await updateHouseholdCategories(fb.db, household.id, changes);
    } finally {
      setSaving(false);
    }
  };

  const startRename = (row: Row) => {
    setRenamingId(row.id);
    setRenameValue(row.label);
  };

  const commitRename = (row: Row) => {
    setRenamingId(null);
    const name = renameValue.trim();
    if (name === "" || name === row.label) return;
    // Dropping `key` (if any) and storing the literal name — but keeping
    // everything else the category had. Rebuilding the entry from scratch used
    // to drop countsToBudget, so renaming a category that had been opted out of
    // the budget silently put it back in and moved every figure on the
    // dashboard. (iOS mutates the whole category, which is why it never had
    // this.)
    void write({
      [row.id]: {
        ...row.def,
        key: undefined,
        name,
      },
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const order = rows.map((r) => r.id);
    [order[index], order[target]] = [order[target], order[index]];
    // Normalize sortOrder to the new index for every entry that moved.
    const changes: Record<string, CategoryDef | null> = {};
    order.forEach((id, i) => {
      const def = household.categories[id];
      if (def !== undefined && def.sortOrder !== i) {
        changes[id] = { ...def, sortOrder: i };
      }
    });
    if (Object.keys(changes).length > 0) void write(changes);
  };

  const remove = (row: Row) => {
    if (rows.length <= 1) return; // rules require ≥ 1 category
    if (!window.confirm(t("deleteConfirm", { name: row.label }))) return;
    void write({ [row.id]: null });
  };

  const submitAdd = async () => {
    const name = newName.trim();
    if (name === "" || atCap) return;
    const id = newCategoryId(household.categories);
    const sortOrder =
      rows.reduce((max, r) => Math.max(max, r.def.sortOrder), -1) + 1;
    await write({ [id]: { name, icon: newIcon, color: newColor, sortOrder } });
    setNewName("");
    setAdding(false);
  };

  return (
    <div className="flex flex-col rounded-[18px] border border-line bg-surface px-[18px] py-4">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="section-label">{t("title")}</span>
        <span className="text-[11px] text-ink-3">{t("countsToBudgetHint")}</span>
        <span className="tnum text-[11px] font-semibold text-ink-3">
          {rows.length}/{MAX_CATEGORIES}
        </span>
      </div>

      <div className="divide-y divide-soft">
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-3 py-2">
            <div
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full"
              style={{ background: categoryCircleBg(row.id, row.def) }}
            >
              <Icon
                name={row.def.icon}
                size={15}
                style={{ color: categoryColor(row.id, row.def) }}
              />
            </div>
            {renamingId === row.id ? (
              <input
                autoFocus
                type="text"
                value={renameValue}
                maxLength={40}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(row);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                aria-label={t("nameLabel")}
                className="min-w-0 flex-1 rounded-[10px] border border-pill bg-bg px-2.5 py-1 text-sm font-semibold text-ink outline-none"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {row.label}
              </span>
            )}
            {/* Whether this category eats into the period budget. Off means
                the spending is still recorded, just not counted. */}
            <button
              type="button"
              role="switch"
              aria-checked={countsToBudget(row.def)}
              aria-label={t("countsToBudget", { name: row.label })}
              title={t("countsToBudget", { name: row.label })}
              disabled={saving}
              onClick={() =>
                void write({
                  [row.id]: {
                    ...row.def,
                    countsToBudget: !countsToBudget(row.def),
                  },
                })
              }
              className="relative h-[22px] w-9 flex-none rounded-full transition-colors disabled:opacity-50"
              style={{
                background: countsToBudget(row.def)
                  ? "var(--good)"
                  : "var(--track)",
              }}
            >
              <span
                className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.2)] transition-all"
                style={{ left: countsToBudget(row.def) ? 18 : 2 }}
              />
            </button>
            <div className="flex flex-none items-center gap-0.5">
              <IconButton
                name="keyboard_arrow_up"
                ariaLabel={t("moveUp", { name: row.label })}
                disabled={saving || index === 0}
                onClick={() => move(index, -1)}
              />
              <IconButton
                name="keyboard_arrow_down"
                ariaLabel={t("moveDown", { name: row.label })}
                disabled={saving || index === rows.length - 1}
                onClick={() => move(index, 1)}
              />
              <IconButton
                name="edit"
                ariaLabel={t("rename", { name: row.label })}
                disabled={saving}
                onClick={() => startRename(row)}
              />
              <IconButton
                name="delete"
                ariaLabel={t("delete", { name: row.label })}
                disabled={saving || rows.length <= 1}
                onClick={() => remove(row)}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Add */}
      <div className="mt-2 border-t border-soft pt-3">
        {atCap ? (
          <span className="text-xs text-ink-3">{t("maxReached")}</span>
        ) : !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 text-[13px] font-bold text-accent-strong"
          >
            <Icon name="add_circle" size={17} className="text-accent" />
            {t("add")}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={newName}
                maxLength={40}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitAdd();
                  if (e.key === "Escape") setAdding(false);
                }}
                placeholder={t("namePlaceholder")}
                aria-label={t("nameLabel")}
                className="min-w-0 flex-1 rounded-[10px] border border-pill bg-bg px-3 py-2 text-[13.5px] font-semibold text-ink outline-none"
              />
              <button
                type="button"
                onClick={() => void submitAdd()}
                disabled={saving || newName.trim() === ""}
                className="rounded-full bg-accent px-4 py-[7px] text-[13px] font-bold text-white disabled:opacity-60"
              >
                {t("save")}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-[13px] font-semibold text-ink-2"
              >
                {t("cancel")}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-xs font-semibold text-ink-3">
                {t("color")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={t("colorOption", { color })}
                    aria-pressed={newColor === color}
                    onClick={() => setNewColor(color)}
                    className="h-[22px] w-[22px] rounded-full"
                    style={{
                      background: color,
                      boxShadow:
                        newColor === color
                          ? "0 0 0 2px var(--surface), 0 0 0 4px var(--ink)"
                          : "none",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-12 pt-1 text-xs font-semibold text-ink-3">
                {t("icon")}
              </span>
              <div className="flex flex-wrap gap-1">
                {CATEGORY_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    aria-label={t("iconOption", { icon })}
                    aria-pressed={newIcon === icon}
                    onClick={() => setNewIcon(icon)}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px]"
                    style={{
                      background:
                        newIcon === icon
                          ? `color-mix(in srgb, ${newColor} var(--cat-circle-alpha), transparent)`
                          : "var(--fill)",
                    }}
                  >
                    <Icon
                      name={icon}
                      size={16}
                      style={{
                        color:
                          newIcon === icon ? newColor : "var(--ink-secondary)",
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
