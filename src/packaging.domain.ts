// ─── v6.44.0 (test-round #7): packaging tare → gross weight ──────────────────
// Gross weight is driven by the PACKAGING, which differs per product. Hazem's
// ruling + data: apples ship in wooden boxes that hold 13 kg of fruit (net) and
// the empty box weighs 1.4 kg. So gross is NOT a flat percentage — it's the net
// plus the tare of however many boxes are needed:
//
//     boxes  = ceil(netKg / box.capacityKg)
//     gross  = netKg + boxes * box.tareKg
//
// The list is a small controlled table (like the product catalog), editable in
// Settings, stored under "packagingTypes". Each goods line names a packaging type;
// gross is derived from it. When no packaging/capacity is known we fall back to a
// gentle flat factor so nothing breaks, and mark it as an estimate.

import type { } from "./types";

export interface PackagingType {
  id: string;          // stable key, e.g. "wooden-box-13"
  label: string;       // "Wooden box (13 kg)"
  capacityKg: number;  // net product capacity per unit (13)
  tareKg: number;      // empty unit weight (1.4)
  appliesTo?: string[]; // product items this is the default for (e.g. ["Apples"])
}

export const PACKAGING_SEED: PackagingType[] = [
  { id: "wooden-box-13", label: "Wooden box (13 kg)", capacityKg: 13, tareKg: 1.4, appliesTo: ["Apples", "Pears"] },
  { id: "carton-10",     label: "Carton (10 kg)",     capacityKg: 10, tareKg: 0.6, appliesTo: ["Oranges", "Nectarines", "Peaches", "Plums", "Kiwis"] },
  { id: "mesh-bag-25",   label: "Mesh bag (25 kg)",   capacityKg: 25, tareKg: 0.15, appliesTo: ["Onions", "Potatoes", "Carrots", "Garlic"] },
];

const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
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

export interface GrossResult { grossKg: number; boxes: number; tareKg: number; estimated: boolean; }

/**
 * Gross weight for a goods line.
 * Priority:
 *   1. explicit packaging type (by id/label) → net + boxes*tare  (exact)
 *   2. default packaging for the product      → net + boxes*tare  (exact)
 *   3. an explicit unit count on the line (boxes) with a known tare
 *   4. fallback flat factor                    → net * 1.06        (estimated)
 */
export function grossForGoodsLine(
  line: { qtyKg?: any; netKg?: any; packaging?: any; packagingId?: any; product?: any; boxes?: any },
  types: PackagingType[],
): GrossResult {
  const net = num(line.netKg) || num(line.qtyKg);
  if (net <= 0) return { grossKg: 0, boxes: 0, tareKg: 0, estimated: false };

  // 1 & 2: resolve a packaging type
  const pk = findPackaging(types, line.packagingId) || findPackaging(types, line.packaging) || defaultPackagingForProduct(types, line.product);
  if (pk && pk.capacityKg > 0) {
    // if the line states an explicit box count, honour it; else derive from capacity
    const boxes = num(line.boxes) > 0 ? Math.ceil(num(line.boxes)) : boxesForNet(net, pk.capacityKg);
    const grossKg = Math.round((net + boxes * pk.tareKg) * 1000) / 1000;
    return { grossKg, boxes, tareKg: pk.tareKg, estimated: false };
  }

  // 4: fallback
  return { grossKg: Math.round(net * FALLBACK_GROSS_FACTOR * 1000) / 1000, boxes: 0, tareKg: 0, estimated: true };
}
