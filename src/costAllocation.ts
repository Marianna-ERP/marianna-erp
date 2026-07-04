// ─────────────────────────────────────────────────────────────────────────────
// costAllocation.ts — pure shipment→lot cost allocation (Batch 1b, BP-52 groundwork)
//
// Replaces the old append-only allocation in Shipments.tsx. Semantics:
//   • Allocation is REPLACE-BY-SOURCE: every re-allocation first removes all lot
//     cost lines whose source belongs to this shipment (`SHP-…/costId`), then
//     writes fresh lines from the shipment's current costs. Editing or deleting
//     a shipment cost can therefore never leave a stale or duplicated lot line
//     (audit finding: "edited shipment cost may leave stale lot cost").
//   • Split is proportional by goods kg per lot; lots without goods rows fall
//     back to an equal split (same behaviour as before).
//   • Pure + injectable: the cost-type mapping is passed in, no module state.
// This is the first step toward BP-52 (lot costs as a fully derived cache).
// ─────────────────────────────────────────────────────────────────────────────

function num(v: any): number {
  const x = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return isFinite(x) ? x : 0;
}

export interface CostTypeMapper {
  inventoryType: (code: string) => string;
  label: (code: string) => string;
}

export function shipmentAllocationSourcePrefix(shipmentNumber: string): string {
  return `${shipmentNumber}/`;
}

/** Kg carried per lot on this shipment (from goods rows). */
export function goodsKgByLot(shipment: any): Record<string, number> {
  const byLot: Record<string, number> = {};
  (shipment.goods || []).forEach((g: any) => {
    if (!g.lotRef) return;
    byLot[g.lotRef] = (byLot[g.lotRef] || 0) + num(g.qtyKg);
  });
  return byLot;
}

export function shipmentLotRefs(shipment: any): string[] {
  const set = new Set<string>();
  (shipment.lotRefs || []).forEach((r: any) => r && set.add(String(r)));
  (shipment.goods || []).forEach((g: any) => g?.lotRef && set.add(String(g.lotRef)));
  return Array.from(set);
}

/**
 * Returns a new lots array with this shipment's costs allocated.
 * Untouched lots keep their identity (===) so React state updates stay cheap.
 */
export function allocateShipmentCostsToLots(shipment: any, lots: any[], mapper: CostTypeMapper): any[] {
  const lotRefs = shipmentLotRefs(shipment);
  if (!lotRefs.length) return lots;

  const goodsByLot = goodsKgByLot(shipment);
  const totalKg =
    (Object.values(goodsByLot) as number[]).reduce((s, v) => s + num(v), 0) || lotRefs.length;
  const prefix = shipmentAllocationSourcePrefix(shipment.number);

  return (lots || []).map(lot => {
    if (!lotRefs.includes(lot.number)) return lot;
    const lotKg = goodsByLot[lot.number] || totalKg / lotRefs.length;
    const factor = totalKg ? lotKg / totalKg : 1 / lotRefs.length;

    // REPLACE-BY-SOURCE: drop every prior line this shipment wrote, then re-add.
    const kept = (lot.costs || []).filter((c: any) => !String(c.source || "").startsWith(prefix));
    const additions = (shipment.costs || []).map((c: any) => {
      const pln = Math.round(num(c.amountPLN) * factor * 100) / 100;
      return {
        type: mapper.inventoryType(c.type),
        label: `${mapper.label(c.type)} (${shipment.number})`,
        source: `${shipment.number}/${c.id}`,
        amount: pln,
        currency: "PLN",
        pln,
      };
    });
    return { ...lot, costs: [...kept, ...additions] };
  });
}
