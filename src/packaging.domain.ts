// ─── v6.44.0 (test-round #7): packaging tare → gross weight ──────────────────
// Gross weight is driven by the PACKAGING, which differs per product. Hazem's
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
}

export const PACKAGING_SEED: PackagingType[] = [
  // 13 kg wooden box, 1.4 kg empty, 72 to a pallet — the real figures from the
  // business's signed loading protocols (21 pallets = 54x13 + 20 x 72x13 = 19 422 kg).
  { id: "wooden-box-13", label: "Wooden box (13 kg)", capacityKg: 13, tareKg: 1.4, boxesPerPallet: 72, palletTareKg: 25, appliesTo: ["Apples", "Pears"] },
  { id: "carton-10",     label: "Carton (10 kg)",     capacityKg: 10, tareKg: 0.6, boxesPerPallet: 96, palletTareKg: 25, appliesTo: ["Oranges", "Nectarines", "Peaches", "Plums", "Kiwis"] },
  { id: "mesh-bag-25",   label: "Mesh bag (25 kg)",   capacityKg: 25, tareKg: 0.15, boxesPerPallet: 40, palletTareKg: 25, appliesTo: ["Onions", "Potatoes", "Carrots", "Garlic"] },
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
