// Seed categories (shared contract) + color helpers.
// Firestore stores each category's LIGHT color; known seed categories switch
// to their dark variant through CSS custom properties defined in globals.css.

import seed from "../../../../shared/categories.json";

export interface SeedCategory {
  id: string;
  key: string;
  icon: { material: string; sfSymbol: string };
  color: { light: string; dark: string };
  sortOrder: number;
}

export const seedCategories: SeedCategory[] = seed.categories;

/** Household `categories` map entry (see shared/schema.md). */
export interface CategoryDef {
  key?: string;
  name?: string;
  icon: string;
  color: string;
  sortOrder: number;
}

/** The categories map to store on a new household document. */
export function seedCategoriesMap(): Record<string, CategoryDef> {
  const map: Record<string, CategoryDef> = {};
  for (const cat of seedCategories) {
    map[cat.id] = {
      key: cat.key,
      icon: cat.icon.material,
      color: cat.color.light,
      sortOrder: cat.sortOrder,
    };
  }
  return map;
}

const seedById = new Map(seedCategories.map((c) => [c.id, c]));

/**
 * Theme-aware CSS color for a category: seed categories resolve through a
 * CSS variable (light/dark pair from categories.json); custom categories
 * use their stored literal color.
 */
export function categoryColor(id: string, def: CategoryDef): string {
  if (def.key !== undefined && seedById.has(id)) return `var(--cat-${id})`;
  return def.color;
}

/** Icon-circle background: category color at 14% (light) / 16% (dark). */
export function categoryCircleBg(id: string, def: CategoryDef): string {
  return `color-mix(in srgb, ${categoryColor(id, def)} var(--cat-circle-alpha), transparent)`;
}

/** Member avatar color, swapped to its dark variant via CSS vars when the
 * stored color is one of the two known member colors. */
export function memberColor(stored: string): string {
  const upper = stored.toUpperCase();
  if (upper === "#2A6FDB") return "var(--member-blue)";
  if (upper === "#E0447C") return "var(--member-pink)";
  return stored;
}

/** Creator gets blue, joiner gets pink (design tokens). */
export const CREATOR_COLOR = "#2A6FDB";
export const JOINER_COLOR = "#E0447C";
