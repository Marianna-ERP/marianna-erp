// v7.17.1 (A-RV-07, owner 9 Oct): master data follows the documents' rule — a delete is blocked while documents use the
// record (they are named), otherwise the record is marked Deleted: it stays on record, struck through, and leaves every
// picker. Pure helpers, shared by Settings and the tests.
const S = (v: any) => String(v ?? "").trim();
const lc = (v: any) => S(v).toLowerCase();
type Stores = { pos?: any[]; orders?: any[]; shipments?: any[]; lots?: any[] };

/** The records still alive — what every picker offers. */
export const liveOnly = <T,>(list: T[] | null | undefined): T[] => (list || []).filter((x: any) => x && !x.deleted);

/** Up to 12 document numbers, then "and N more". */
export const namedList = (docs: string[]): string => docs.slice(0, 12).join(", ") + (docs.length > 12 ? ` and ${docs.length - 12} more` : "");

/** Documents whose lines name a packaging type, by its id or its label. */
export function packagingUsers(t: any, stores: Stores): string[] {
  const id = lc(t?.id), label = lc(t?.label);
  const hit = (x: any) => !!x && ((!!id && (lc(x.packagingId) === id || lc(x.packaging) === id)) || (!!label && lc(x.packaging) === label));
  const out = new Set<string>();
  (stores.pos || []).forEach(p => { if ((p?.items || []).some(hit)) out.add(S(p.number)); });
  (stores.orders || []).forEach(o => { if ((o?.items || []).some(hit)) out.add(S(o.number)); });
  (stores.shipments || []).forEach(s => { if ((s?.goods || []).some(hit)) out.add(S(s.number)); });
  (stores.lots || []).forEach(l => { if (hit(l)) out.add(S(l.number)); });
  return Array.from(out).filter(Boolean);
}

/** Documents whose lines name a catalog item — and that variety, when one is given. */
export function catalogUsers(item: string, variety: string | null, stores: Stores): string[] {
  const it = lc(item), v = lc(variety);
  const hit = (x: any) => !!x && lc(x.product) === it && (!variety || lc(x.variety) === v);
  const out = new Set<string>();
  (stores.pos || []).forEach(p => { if ((p?.items || []).some(hit)) out.add(S(p.number)); });
  (stores.orders || []).forEach(o => { if ((o?.items || []).some(hit)) out.add(S(o.number)); });
  (stores.lots || []).forEach(l => { if (hit(l)) out.add(S(l.number)); });
  return Array.from(out).filter(Boolean);
}

/** A catalog item marked Deleted (kept, struck through); typing its name again brings it back. */
export function softDeleteCatalogItem(catalog: any[], item: string, todayISO: string): any[] {
  return (catalog || []).map(c => lc(c?.item) === lc(item) ? { ...c, deleted: true, deletedAt: todayISO } : c);
}
export function restoreCatalogItem(catalog: any[], item: string): any[] {
  return (catalog || []).map(c => lc(c?.item) === lc(item) ? (({ deleted, deletedAt, ...rest }: any) => rest)(c) : c);
}
/** A variety moves from 'varieties' (what pickers read) to 'deletedVarieties' (kept, struck through). */
export function softDeleteVariety(catalog: any[], item: string, variety: string, todayISO: string): any[] {
  return (catalog || []).map(c => lc(c?.item) !== lc(item) ? c : {
    ...c, varieties: (c.varieties || []).filter((x: string) => lc(x) !== lc(variety)),
    deletedVarieties: [...(c.deletedVarieties || []).filter((x: string) => lc(x) !== lc(variety)), S(variety)], deletedVarietiesAt: { ...(c.deletedVarietiesAt || {}), [S(variety)]: todayISO } });
}

// ── v7.18.3 (A-AU-5): an item's calibres and colorations follow the same rule as its varieties ──
const FIELD = (kind: "calibres" | "colorations") => kind === "calibres" ? "size" : "coloration";
/** Documents whose lines carry this calibre / coloration of the item. */
export function catalogValueUsers(item: string, kind: "calibres" | "colorations", value: string, stores: Stores): string[] {
  const it = lc(item), v = lc(value), f = FIELD(kind);
  const hit = (x: any) => !!x && lc(x.product) === it && lc(x[f]) === v;
  const out = new Set<string>();
  (stores.pos || []).forEach(p => { if ((p?.items || []).some(hit)) out.add(S(p.number)); });
  (stores.orders || []).forEach(o => { if ((o?.items || []).some(hit)) out.add(S(o.number)); });
  (stores.lots || []).forEach(l => { if (hit(l)) out.add(S(l.number)); });
  return Array.from(out).filter(Boolean);
}
/** A calibre / coloration moves to the item's deleted list (kept, struck through). */
export function softDeleteCatalogValue(catalog: any[], item: string, kind: "calibres" | "colorations", value: string, todayISO: string): any[] {
  const delKey = kind === "calibres" ? "deletedCalibres" : "deletedColorations";
  return (catalog || []).map(c => lc(c?.item) !== lc(item) ? c : {
    ...c, [kind]: (c[kind] || []).filter((x: string) => lc(x) !== lc(value)),
    [delKey]: [...(c[delKey] || []).filter((x: string) => lc(x) !== lc(value)), S(value)], [delKey + "At"]: { ...(c[delKey + "At"] || {}), [S(value)]: todayISO } });
}
/** The values written on the item's lines (PO, SO, lots) — once each, ignoring case and spaces at the ends; the most used
 *  spelling is shown. For the one-click add in Settings → Catalog. */
export function valuesInUse(item: string, kind: "calibres" | "colorations", stores: Stores): { value: string; lines: number }[] {
  const it = lc(item), f = FIELD(kind); const m = new Map<string, Map<string, number>>();
  const see = (x: any) => { if (!x || lc(x.product) !== it) return; const v = S(x[f]); if (!v) return; const k = v.toLowerCase(); const sp = m.get(k) || new Map(); sp.set(v, (sp.get(v) || 0) + 1); m.set(k, sp); };
  (stores.pos || []).forEach(p => (p?.items || []).forEach(see)); (stores.orders || []).forEach(o => (o?.items || []).forEach(see)); (stores.lots || []).forEach(see);
  return Array.from(m.values()).map(sp => { const best = Array.from(sp.entries()).sort((a, b) => b[1] - a[1])[0]; return { value: best[0], lines: Array.from(sp.values()).reduce((a, b) => a + b, 0) }; })
    .sort((a, b) => b.lines - a.lines || a.value.localeCompare(b.value, "pl", { numeric: true }));
}
