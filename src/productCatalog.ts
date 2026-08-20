// ─── v6.18.16: Product catalog ──────────────────────────────────────────────
// A single controlled list of Item → Variety so the team picks products
// consistently instead of free-typing them. Seeded from the uploaded items
// list (plural item names; "Granny Smith" capitalisation fixed). Stored in
// localStorage under "productCatalog" and editable in Settings → Product catalog.
// Sizes are deliberately NOT here — size stays its own field on the line/lot.

// v6.32.0 (R7b-3): single contract — the CatalogItem interface lives in
// types.ts (which also carries defaultCnCode for BP-8); re-exported here for
// existing importers.
import type { CatalogItem } from "./types";
export type { CatalogItem };

export const PRODUCT_CATALOG_SEED: CatalogItem[] = [
  { item: "Apples", varieties: ["Braeburn", "Elise", "Elstar", "Fuji", "Gala", "Gala Must", "Gala Pasek", "Gala Royal", "Gala Schniga", "Gala Schniko Red", "Gloster", "Golden Altesse", "Golden Delicious", "Granny Smith", "Idared", "Jazz", "Jonagold", "Jonagored", "Kanzi", "Modi", "Morgenduft", "Naidared", "Pink Lady", "Pinova", "Prince", "Red Cap", "Red Chief", "Red Delicious", "Red Jeromine"] },
  { item: "Carrots", varieties: ["Fresh"] },
  { item: "Garlic", varieties: ["White", "Reddish"] },
  { item: "Kiwis", varieties: ["Gold", "Green Light", "Hyward"] },
  { item: "Nectarines", varieties: ["White Flesh", "White Flesh Flat", "Yellow Flesh", "Yellow Flesh Flat"] },
  { item: "Onions", varieties: ["Red", "Yellow"] },
  { item: "Oranges", varieties: ["Navel", "Valencia"] },
  { item: "Peaches", varieties: ["White Flesh", "White Flesh Flat", "Yellow Flesh", "Yellow Flesh Flat"] },
  { item: "Plums", varieties: ["Red Flesh", "Yellow Flesh"] },
  { item: "Potatoes", varieties: ["Spunta"] },
];

const norm = (s: any) => String(s ?? "").trim();
const lc = (s: any) => norm(s).toLowerCase();

/** Sorted list of item names. */
export function catalogItems(catalog: CatalogItem[]): string[] {
  return (catalog || []).map(c => c.item).filter(Boolean);
}

/** Varieties for a given item (case-insensitive match). */
export function varietiesForItem(catalog: CatalogItem[], item: string): string[] {
  const row = (catalog || []).find(c => lc(c.item) === lc(item));
  return row ? row.varieties.slice() : [];
}

/** Add an item if missing; returns the (possibly unchanged) catalog. One source of truth. */
export function addCatalogItem(catalog: CatalogItem[], item: string): CatalogItem[] {
  const name = norm(item);
  if (!name) return catalog;
  if ((catalog || []).some(c => lc(c.item) === lc(name))) return catalog;
  return [...(catalog || []), { item: name, varieties: [] }].sort((a, b) => a.item.localeCompare(b.item));
}

/** Add a variety under an item (creating the item if needed). */
export function addCatalogVariety(catalog: CatalogItem[], item: string, variety: string): CatalogItem[] {
  const name = norm(item); const v = norm(variety);
  if (!name) return catalog;
  let out = catalog || [];
  if (!out.some(c => lc(c.item) === lc(name))) out = addCatalogItem(out, name);
  return out.map(c => {
    if (lc(c.item) !== lc(name)) return c;
    if (!v || c.varieties.some(x => lc(x) === lc(v))) return c;
    return { ...c, varieties: [...c.varieties, v].sort((a, b) => a.localeCompare(b)) };
  });
}

export function removeCatalogVariety(catalog: CatalogItem[], item: string, variety: string): CatalogItem[] {
  return (catalog || []).map(c => lc(c.item) === lc(item) ? { ...c, varieties: c.varieties.filter(x => lc(x) !== lc(variety)) } : c);
}

export function removeCatalogItem(catalog: CatalogItem[], item: string): CatalogItem[] {
  return (catalog || []).filter(c => lc(c.item) !== lc(item));
}

export function renameCatalogItem(catalog: CatalogItem[], oldItem: string, newItem: string): CatalogItem[] {
  const nn = norm(newItem); if (!nn) return catalog;
  return (catalog || []).map(c => lc(c.item) === lc(oldItem) ? { ...c, item: nn } : c).sort((a, b) => a.item.localeCompare(b.item));
}

/** Merge Item/Variety rows (e.g. from a CSV import) into the catalog without duplicating. */
export function mergeCatalogRows(catalog: CatalogItem[], rows: { item: string; variety?: string; cnCode?: string }[]): CatalogItem[] {
  let out = catalog || [];
  (rows || []).forEach(r => {
    const item = norm(r.item); if (!item) return;
    out = r.variety ? addCatalogVariety(out, item, r.variety) : addCatalogItem(out, item);
    if (r.cnCode) out = setCatalogCnCode(out, item, r.cnCode);
  });
  return out;
}

/** BP-8 (v6.34.1): set the per-item default CN/HS code. */
export function setCatalogCnCode(catalog: CatalogItem[], item: string, cnCode: string): CatalogItem[] {
  const key = norm(item);
  return (catalog || []).map(c => norm(c.item) === key ? { ...c, defaultCnCode: cnCode.trim() } : c);
}

/** The default CN/HS for an item (empty string when unset). */
export function cnCodeForItem(catalog: CatalogItem[], item: string): string {
  const key = norm(item);
  const hit = (catalog || []).find(c => norm(c.item) === key);
  return (hit && (hit as any).defaultCnCode) || "";
}

/** Catalog → flat Item/Variety rows for CSV export (one row per variety; items with none get a single row). */
export function catalogToRows(catalog: CatalogItem[]): { item: string; variety: string; cnCode: string }[] {
  const rows: { item: string; variety: string; cnCode: string }[] = [];
  (catalog || []).forEach(c => {
    const cn = (c as any).defaultCnCode || "";
    if (!c.varieties.length) rows.push({ item: c.item, variety: "", cnCode: cn });
    else c.varieties.forEach(v => rows.push({ item: c.item, variety: v, cnCode: cn }));
  });
  return rows;
}
