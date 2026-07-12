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

/** Rules cap: households/{id}.categories map may hold at most 30 entries. */
export const MAX_CATEGORIES = 30;

/** The 8 seed palette colors (light variants) offered for custom categories. */
export const CATEGORY_PALETTE: string[] = seedCategories.map(
  (c) => c.color.light,
);

/** Curated Material Symbols for custom categories. */
export const CATEGORY_ICONS: string[] = [
  "shopping_basket",
  "local_cafe",
  "restaurant",
  "directions_bus",
  "home",
  "favorite",
  "movie",
  "shopping_bag",
  "pets",
  "flight",
  "fitness_center",
  "school",
  "redeem",
  "local_gas_station",
  "checkroom",
  "savings",
];

/**
 * Random id for a custom category. Plain lowercase alphanumerics so the id
 * is safe inside a Firestore field path ("categories.<id>").
 */
export function newCategoryId(existing: Record<string, unknown>): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let id = "c";
    for (const byte of bytes) id += alphabet[byte % alphabet.length];
    if (!(id in existing)) return id;
  }
}

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
