"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocateShipmentCostsToLots = exports.shipmentLotRefs = exports.goodsKgByLot = exports.shipmentAllocationSourcePrefix = void 0;
function num(v) {
    const x = parseFloat(String(v !== null && v !== void 0 ? v : "").replace(/\s/g, "").replace(",", "."));
    return isFinite(x) ? x : 0;
}
function shipmentAllocationSourcePrefix(shipmentNumber) {
    return `${shipmentNumber}/`;
}
exports.shipmentAllocationSourcePrefix = shipmentAllocationSourcePrefix;
/** Kg carried per lot on this shipment (from goods rows). */
function goodsKgByLot(shipment) {
    const byLot = {};
    (shipment.goods || []).forEach((g) => {
        if (!g.lotRef)
            return;
        byLot[g.lotRef] = (byLot[g.lotRef] || 0) + num(g.qtyKg);
    });
    return byLot;
}
exports.goodsKgByLot = goodsKgByLot;
function shipmentLotRefs(shipment) {
    const set = new Set();
    (shipment.lotRefs || []).forEach((r) => r && set.add(String(r)));
    (shipment.goods || []).forEach((g) => (g === null || g === void 0 ? void 0 : g.lotRef) && set.add(String(g.lotRef)));
    return Array.from(set);
}
exports.shipmentLotRefs = shipmentLotRefs;
/**
 * Returns a new lots array with this shipment's costs allocated.
 * Untouched lots keep their identity (===) so React state updates stay cheap.
 */
function allocateShipmentCostsToLots(shipment, lots, mapper) {
    const lotRefs = shipmentLotRefs(shipment);
    if (!lotRefs.length)
        return lots;
    const goodsByLot = goodsKgByLot(shipment);
    const totalKg = Object.values(goodsByLot).reduce((s, v) => s + num(v), 0) || lotRefs.length;
    const prefix = shipmentAllocationSourcePrefix(shipment.number);
    return (lots || []).map(lot => {
        if (!lotRefs.includes(lot.number))
            return lot;
        const lotKg = goodsByLot[lot.number] || totalKg / lotRefs.length;
        const factor = totalKg ? lotKg / totalKg : 1 / lotRefs.length;
        // REPLACE-BY-SOURCE: drop every prior line this shipment wrote, then re-add.
        const kept = (lot.costs || []).filter((c) => !String(c.source || "").startsWith(prefix));
        const additions = (shipment.costs || []).map((c) => {
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
exports.allocateShipmentCostsToLots = allocateShipmentCostsToLots;
