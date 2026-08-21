// ── PRICING UNIT: SELL BY BOX (v6.61.0) ─────────────────────────────────────
// User ruling, Aug 2026:
//
//   "We may need to sell some product by boxes but I do not want to tear apart
//    the system and have to test it all over again."
//   "Boxes are exact by weight."
//
// So this is deliberately NOT a change to how quantity is stored. Kilos remain
// the single stored quantity everywhere. Selling by box is a PRICING AND
// PRESENTATION layer: a line may state its quantity in boxes and its price per
// box, and the kilos are derived from the packaging that line already names.
//
// WHAT THIS TOUCHES:  sales/purchase line entry, and how a line renders on a
//                     document or invoice.
// WHAT IT DOES NOT:   inventory movements, landed-cost allocation, the loading
//                     protocol, claims, truck capacity, the PO/SO supply
//                     calculations. Every one of those keeps reading qtyKg and
//                     never learns anything changed. That is the whole point —
//                     the tested surface stays tested.
//
// Boxes being exact by weight is what makes this safe: boxes x kg-per-box is
// arithmetic, not an estimate, so there is no nominal-versus-actual divergence
// to reconcile and no tolerance to tune. If that ever stops being true — a box
// sold by count whose weight varies — this module is where the two figures
// would have to part company, and the rest of the system still would not care.

import { PackagingType, findPackaging, defaultPackagingForProduct } from "./packaging.domain";

export type PricingUnit = "kg" | "box";

function num(v: any): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

/** kg per box for a line, from the packaging it already names.
 *  0 when the packaging cannot be resolved — the caller must not guess. */
export function kgPerBoxForLine(line: any, types: PackagingType[]): number {
  const pk = findPackaging(types, line?.packagingId)
    || findPackaging(types, line?.packaging)
    || defaultPackagingForProduct(types, line?.product);
  if (pk && num(pk.capacityKg) > 0) return num(pk.capacityKg);
  // v6.65.0 (D-18): a weight WRITTEN IN the packaging text ("5 kg carton box")
  // is a stated fact, not a guess — lines whose packaging isn't in the catalog
  // (free-typed) were resolving to 0 kg/box and zeroing the whole document chain.
  const m = String(line?.packaging || "").match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (m) { const v = num(m[1]); if (v > 0) return v; }
  return 0;
}

/** How this line is priced. Absent = kg, which is every existing line. */
export function pricingUnit(line: any): PricingUnit {
  return String(line?.pricingUnit || "").toLowerCase() === "box" ? "box" : "kg";
}

export interface LineQuantity {
  unit: PricingUnit;
  qtyKg: number;          // the stored quantity — always kg
  boxes: number;          // 0 when priced by kg and packaging is unknown
  kgPerBox: number;
  /** True when the line asks to be priced by box but no box weight is known,
   *  so no conversion is possible. Reported rather than guessed: inventing a
   *  box weight would put a wrong number on an invoice. */
  unresolved: boolean;
}

/** The line's quantity in both units. When priced by box, the BOX COUNT is the
 *  figure the user entered and kilos are derived from it; when priced by kg it
 *  is the other way round. */
export function lineQuantity(line: any, types: PackagingType[]): LineQuantity {
  const unit = pricingUnit(line);
  const kgPerBox = kgPerBoxForLine(line, types);
  if (unit === "box") {
    const boxes = Math.round(num(line?.boxes));
    if (kgPerBox <= 0) return { unit, qtyKg: num(line?.qty ?? line?.qtyKg), boxes, kgPerBox: 0, unresolved: true };
    return { unit, qtyKg: Math.round(boxes * kgPerBox * 1000) / 1000, boxes, kgPerBox, unresolved: false };
  }
  const qtyKg = num(line?.qty ?? line?.qtyKg);
  return { unit, qtyKg, boxes: kgPerBox > 0 ? Math.round(qtyKg / kgPerBox) : 0, kgPerBox, unresolved: false };
}

/** The line total. Priced by box: boxes x price-per-box. Priced by kg: the
 *  existing kg x price-per-kg, unchanged. */
export function lineTotal(line: any, types: PackagingType[]): number {
  const q = lineQuantity(line, types);
  const price = num(line?.unitPrice);
  if (q.unit === "box") return Math.round(q.boxes * price * 100) / 100;
  return Math.round(q.qtyKg * price * 100) / 100;
}

/** What a document should print for this line: "400 boxes x 13 kg (5 200 kg)"
 *  or the plain kilos. The kilos are always shown, because that is what
 *  physically moves and what a claim or a customs declaration will refer to. */
export function quantityLabel(line: any, types: PackagingType[]): string {
  const q = lineQuantity(line, types);
  const kg = `${Math.round(q.qtyKg).toLocaleString("pl-PL")} kg`;
  if (q.unit !== "box") return kg;
  if (q.unresolved) return `${q.boxes.toLocaleString("pl-PL")} boxes — box weight not set`;
  return `${q.boxes.toLocaleString("pl-PL")} boxes × ${q.kgPerBox} kg (${kg})`;
}

/** How the price should read on a document. */
export function priceLabel(line: any, currency = ""): string {
  const price = num(line?.unitPrice);
  const cur = currency ? ` ${currency}` : "";
  return pricingUnit(line) === "box" ? `${price}${cur}/box` : `${price}${cur}/kg`;
}

/** Switching a line between units keeps the SAME PHYSICAL QUANTITY and converts
 *  the price so the line total does not silently move. Changing how you price
 *  something must not change what it is worth. */
export function convertLineUnit(line: any, to: PricingUnit, types: PackagingType[]): any {
  const from = pricingUnit(line);
  if (from === to) return line;
  const kgPerBox = kgPerBoxForLine(line, types);
  if (kgPerBox <= 0) return { ...line, pricingUnit: to };   // nothing to convert with
  const q = lineQuantity(line, types);
  const price = num(line?.unitPrice);
  if (to === "box") {
    return { ...line, pricingUnit: "box", boxes: q.boxes, qty: Math.round(q.boxes * kgPerBox * 1000) / 1000, unitPrice: Math.round(price * kgPerBox * 100) / 100 };
  }
  return { ...line, pricingUnit: "kg", qty: q.qtyKg, boxes: q.boxes, unitPrice: Math.round((price / kgPerBox) * 100) / 100 };
}

/** Lines asking to be priced by box with no resolvable box weight. Surfaced on
 *  the order screen so the problem is caught before an invoice is issued. */
export function unresolvedBoxLines(lines: any[], types: PackagingType[]): string[] {
  return (lines || [])
    .filter(l => pricingUnit(l) === "box" && lineQuantity(l, types).unresolved)
    .map(l => String(l?.product || "line"));
}
