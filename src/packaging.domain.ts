// ─── v6.44.0 (test-round #7): packaging tare → gross weight ──────────────────
// Gross weight is driven by the PACKAGING, which differs per product. the owner's
// ruling + data: apples ship in wooden boxes that hold 13 kg of fruit (net) and
// the empty box weighs 1.4 kg. So gross is NOT a flat percentage — it's the net
// plus the tare of however many boxes are needed:
//
//     boxes   = ceil(netKg / box.capacityKg)
//     pallets = ceil(boxes / box.boxesPerPallet)
//     gross   = netKg + boxes * box.tareKg + pallets * box.palletTareKg
//
// v6.46.0: the pallets themselves were missing from gross — 21 wooden pallets is
// roughly another 525 kg, which matters for axle limits and freight.
//
// The list is a small controlled table (like the product catalog), editable in
// Settings, stored under "packagingTypes". Each goods line names a packaging type;
// gross is derived from it. When no packaging/capacity is known we fall back to a
// gentle flat factor so nothing breaks, and mark it as an estimate.

import type { } from "./types";
import { parseNum } from "./numbers";   // v7.18.0 (A-AU-1): the one number parser (source gate)

export interface PackagingType {
  id: string;              // stable key, e.g. "wooden-box-13"
  label: string;           // "Wooden box (13 kg)"
  capacityKg: number;      // net product capacity per unit (13)
  tareKg: number;          // empty unit weight (1.4)
  /** v6.46.0: how many boxes fit on one pallet — lets the system derive the
   *  pallet manifest (e.g. 1494 boxes = 20 full pallets of 72 + 54) exactly as
   *  the paper loading protocol records it. */
  boxesPerPallet?: number;
  /** v6.46.0: the empty pallet's own weight. Gross weight on a transport order
   *  must include it (21 wooden pallets ≈ 525 kg — material for axle limits). */
  palletTareKg?: number;
  appliesTo?: string[];    // product items this is the default for (e.g. ["Apples"])
  /** v7.27.9 (FZ-29, RM-2 F-5): the pallet the boxes go on — a truck's pallet type is read from its goods' packaging. */
  palletType?: "standard" | "euro";
  }

export const PACKAGING_SEED: PackagingType[] = [
  // 13 kg wooden box, 1.4 kg empty, 72 to a pallet — the real figures from the
  // business's signed loading protocols (21 pallets = 54x13 + 20 x 72x13 = 19 422 kg).
  { id: "wooden-box-13", label: "Wooden box (13 kg)", capacityKg: 13, tareKg: 1.4, boxesPerPallet: 72, palletTareKg: 25, appliesTo: ["Apples", "Pears"] },
  { id: "carton-10",     label: "Carton (10 kg)",     capacityKg: 10, tareKg: 0.6, boxesPerPallet: 96, palletTareKg: 25, appliesTo: ["Oranges", "Nectarines", "Peaches", "Plums", "Kiwis"] },
  { id: "mesh-bag-25",   label: "Mesh bag (25 kg)",   capacityKg: 25, tareKg: 0.15, boxesPerPallet: 40, palletTareKg: 25, appliesTo: ["Onions", "Potatoes", "Carrots", "Garlic"] },
];

const num = (v: any): number => parseNum(v);   // v7.22.2 (FZ-22): one reader for every number — spaces and a decimal comma read the same everywhere
const lc = (s: any) => String(s ?? "").trim().toLowerCase();

/** Fallback flat gross factor when packaging/capacity is unknown (≈6%). */
export const FALLBACK_GROSS_FACTOR = 1.06;

/** Look a packaging type up by id, else by label. */
export function findPackaging(types: PackagingType[], idOrLabel: any): PackagingType | null {
  const key = lc(idOrLabel);
  if (!key) return null;
  return (types || []).find(p => lc(p.id) === key || lc(p.label) === key) || null;
}

/** The default packaging for a product item, if any is marked appliesTo it. */
export function defaultPackagingForProduct(types: PackagingType[], product: any): PackagingType | null {
  const p = lc(product);
  if (!p) return null;
  return (types || []).find(t => (t.appliesTo || []).some(a => lc(a) === p)) || null;
}

/** Number of packaging units needed to hold netKg (whole boxes, rounded up). */
export function boxesForNet(netKg: number, capacityKg: number): number {
  if (!(capacityKg > 0) || !(netKg > 0)) return 0;
  return Math.ceil(netKg / capacityKg);
}

export interface GrossResult {
  grossKg: number;      // net + box tare + pallet tare
  boxes: number;        // total boxes needed
  tareKg: number;       // per-box tare used
  pallets: number;      // pallets needed (0 when boxesPerPallet unknown)
  palletTareKg: number; // per-pallet tare used
  boxTareTotalKg: number;
  palletTareTotalKg: number;
  estimated: boolean;
}

/** Pallet manifest: full pallets of `boxesPerPallet`, plus a final part-pallet. */
export function palletManifest(boxes: number, boxesPerPallet: number): { boxes: number }[] {
  if (!(boxes > 0)) return [];
  if (!(boxesPerPallet > 0)) return [{ boxes }];
  const rows: { boxes: number }[] = [];
  let left = Math.ceil(boxes);
  while (left > 0) { const n = Math.min(left, Math.floor(boxesPerPallet)); rows.push({ boxes: n }); left -= n; }
  return rows;
}

/**
 * Gross weight for a goods line.
 * Priority:
 *   1. explicit packaging type (by id/label) → net + boxes*tare  (exact)
 *   2. default packaging for the product      → net + boxes*tare  (exact)
 *   3. an explicit unit count on the line (boxes) with a known tare
 *   4. fallback flat factor                    → net * 1.06        (estimated)
 */
export function grossForGoodsLine(
  line: { qtyKg?: any; netKg?: any; packaging?: any; packagingId?: any; product?: any; boxes?: any; pallets?: any },
  types: PackagingType[],
): GrossResult {
  const net = num(line.netKg) || num(line.qtyKg);
  const empty: GrossResult = { grossKg: 0, boxes: 0, tareKg: 0, pallets: 0, palletTareKg: 0, boxTareTotalKg: 0, palletTareTotalKg: 0, estimated: false };
  if (net <= 0) return empty;

  // 1 & 2: resolve a packaging type
  const pk = findPackaging(types, line.packagingId) || findPackaging(types, line.packaging) || defaultPackagingForProduct(types, line.product);
  if (pk && pk.capacityKg > 0) {
    // if the line states an explicit box count, honour it; else derive from capacity
    const boxes = num(line.boxes) > 0 ? Math.ceil(num(line.boxes)) : boxesForNet(net, pk.capacityKg);
    const bpp = num(pk.boxesPerPallet);
    // an explicit pallet count on the line wins (the returned protocol knows best)
    const pallets = num(line.pallets) > 0 ? Math.ceil(num(line.pallets)) : (bpp > 0 ? Math.ceil(boxes / bpp) : 0);
    const palletTareKg = num(pk.palletTareKg);
    const boxTareTotalKg = Math.round(boxes * pk.tareKg * 1000) / 1000;
    const palletTareTotalKg = Math.round(pallets * palletTareKg * 1000) / 1000;
    const grossKg = Math.round((net + boxTareTotalKg + palletTareTotalKg) * 1000) / 1000;
    return { grossKg, boxes, tareKg: pk.tareKg, pallets, palletTareKg, boxTareTotalKg, palletTareTotalKg, estimated: false };
  }

  // 4: fallback
  return { ...empty, grossKg: Math.round(net * FALLBACK_GROSS_FACTOR * 1000) / 1000, estimated: true };
}

// ══ v7.18.0 (A-AU-1, owner 9 Oct — P-8, 'lists instead of typing') ═══════════════════════════════════════════════════════════
// An order line's packaging is PICKED from Settings → Packaging types; kilos per box and tare come from the type. A new type is
// added to that same list from the picker. The spellings typed before are listed once, grouped under the type they most likely
// are (a suggestion only), and the owner links each one once: its lines then name the type, and print the type's name.
const spellKey = (s: any) => lc(s).replace(/\s+/g, " ");
const isPcsType = (t: PackagingType) => /\b(pcs|szt)\b/.test(lc(t.label));
const live = (types: PackagingType[]) => (types || []).filter((t: any) => t && !t.deleted);

/** A type from the picker's small window — the same checks as Settings → Packaging types. A deleted type of the same name comes back. */
export function packagingTypeFromForm(form: any, existing: PackagingType[]): { type?: PackagingType; error?: string; restored?: boolean } {
  const label = String(form?.label ?? "").trim();
  const blank = (v: any) => String(v ?? "").trim() === "";
  const cap = parseNum(form?.capacityKg), tare = blank(form?.tareKg) ? NaN : parseNum(form?.tareKg);
  if (!label) return { error: "Give the packaging a name, e.g. \u201cWooden box (13 kg)\u201d." };
  if (!(cap > 0)) return { error: "How many kg of product does one unit hold?" };
  if (!(tare >= 0)) return { error: "How much does the empty unit weigh?" };
  const same = (existing || []).find(t => lc(t.label) === lc(label));
  if (same && !(same as any).deleted) return { error: `\u201c${label}\u201d is already a packaging type \u2014 pick it from the list.` };
  const figures = { capacityKg: cap, tareKg: tare, boxesPerPallet: parseNum(form?.boxesPerPallet) || 0, palletTareKg: parseNum(form?.palletTareKg) || 0 };
  if (same) { const { deleted, deletedAt, ...rest } = same as any; return { type: { ...rest, label, ...figures }, restored: true }; }
  const ids = new Set((existing || []).map(t => String(t.id)));
  let id = lc(label).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "packaging";
  if (ids.has(id)) { let k = 2; while (ids.has(`${id}-${k}`)) k++; id = `${id}-${k}`; }
  return { type: { id, label, ...figures, appliesTo: [] } };
}

/** The type a typed spelling most likely is — a suggestion the owner confirms, never applied on its own. Only one
 *  candidate is ever suggested: the kilos (or pieces) written in the text must match the type's, and a material named in
 *  the text (wood, carton, bag) must be the type's too. "13 kg boxes" fits two types, so nothing is suggested. */
export function suggestPackagingType(text: any, types: PackagingType[]): PackagingType | null {
  const s = spellKey(text); if (!s) return null;
  const list = live(types);
  const exact = list.find(t => lc(t.label) === s); if (exact) return exact;
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(kg|pcs|szt)?/); if (!m) return null;
  const n = parseNum(m[1]); const pcs = m[2] === "pcs" || m[2] === "szt";
  const mat = /wood|drewn/.test(s) ? "wood" : /bag|mesh|worek|siatk/.test(s) ? "bag" : /cart|kart|caron/.test(s) ? "carton" : "";
  let cands = list.filter(t => pcs ? (isPcsType(t) && new RegExp(`(^|\\D)${n}(\\D|$)`).test(lc(t.label))) : (!isPcsType(t) && num(t.capacityKg) === n));
  if (mat) cands = cands.filter(t => `${lc(t.label)} ${lc(t.id)}`.includes(mat));
  return cands.length === 1 ? cands[0] : null;
}

export interface TypedSpelling { spelling: string; key: string; poLines: number; soLines: number; docs: string[]; suggestion: string | null; }
const linkedLine = (it: any, ids: Set<string>) => it?.packagingId != null && String(it.packagingId) !== "" && ids.has(lc(it.packagingId));
const openDoc = (doc: any) => !!doc && !doc.deleted && doc.status !== "Cancelled";

/** Every packaging typed on a live PO / SO line and not linked to a type — once per spelling (case and spaces ignored). */
export function typedPackagingSpellings(stores: { pos?: any[]; orders?: any[] }, types: PackagingType[]): TypedSpelling[] {
  const ids = new Set((types || []).map(t => lc(t.id)));
  const map = new Map<string, TypedSpelling>();
  const visit = (doc: any, side: "po" | "so") => {
    if (!openDoc(doc)) return;
    (doc.items || []).forEach((it: any) => {
      const txt = String(it?.packaging ?? "").trim(); if (!txt || linkedLine(it, ids)) return;
      const key = spellKey(txt); let e = map.get(key);
      if (!e) { e = { spelling: txt.replace(/\s+/g, " "), key, poLines: 0, soLines: 0, docs: [], suggestion: suggestPackagingType(txt, types)?.id ?? null }; map.set(key, e); }
      if (side === "po") e.poLines++; else e.soLines++;
      if (!e.docs.includes(String(doc.number))) e.docs.push(String(doc.number));
    });
  };
  (stores.pos || []).forEach(p => visit(p, "po")); (stores.orders || []).forEach(o => visit(o, "so"));
  return Array.from(map.values()).sort((a, b) => (b.poLines + b.soLines) - (a.poLines + a.soLines) || a.spelling.localeCompare(b.spelling));
}

/** Link one spelling to its type on a list of POs or SOs: every live line typed that way names the type and takes its name.
 *  Lines already linked, other spellings, deleted and cancelled documents are left as they are. */
export function linkSpellingOnDocs(docs: any[], key: string, type: PackagingType, types: PackagingType[]): { docs: any[]; changed: string[]; lines: number } {
  const ids = new Set((types || []).map(t => lc(t.id))); ids.add(lc(type.id));
  const changed: string[] = []; let lines = 0;
  const next = (docs || []).map((doc: any) => {
    if (!openDoc(doc)) return doc;
    let hit = false;
    const items = (doc.items || []).map((it: any) => {
      if (spellKey(it?.packaging) !== key) return it;
      if (linkedLine(it, ids) && String(it.packagingId) !== String(type.id)) return it;   // it already names another type
      if (String(it?.packagingId ?? "") === String(type.id) && String(it.packaging) === type.label) return it;
      hit = true; lines++; return { ...it, packagingId: type.id, packaging: type.label };
    });
    if (!hit) return doc;
    changed.push(String(doc.number)); return { ...doc, items };
  });
  return { docs: next, changed, lines };
}
