// ─────────────────────────────────────────────────────────────────────────────
// inventory.domain.ts — pure inventory engine (Consolidation Batch 1)
//
// The movement→lot-state reducer, extracted verbatim from Inventory.tsx so it
// can be unit-tested and, later (BP-32), driven by shipment events. Pure: no
// React, no module state. The location taxonomy is injected (locById) so the
// reducer stays decoupled from the UI's location registry.
// Audit P2-3; tests in tests/run-engines.mjs (P2-5).
// ─────────────────────────────────────────────────────────────────────────────

export function parseNum(v: any): number {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export interface LocResolved { type?: string; legacyType?: string; [k: string]: any }
export type LocByIdFn = (id: any) => LocResolved | null | undefined;

/**
 * Replays a lot's movement history into its derived state.
 * - Voided movements are excluded (v6.18.17 Void feature).
 * - IN adds to received+physical and moves the lot; TRANSFER moves only;
 *   SHIP_OUT reduces physical but does NOT move the remaining stock (v6.18.10 #3);
 *   REVERSAL restores; DAMAGE reduces physical into damagedKg;
 *   CLAIM is client-side (no warehouse stock effect, v6.18.10 #5); RECLASS is a no-op on kg.
 * - Status is derived from the final physical state + location taxonomy.
 */
export function recomputeLotFromMovements(lot: any, movements: any[], locById: LocByIdFn) {
  let receivedKg = 0, physicalKg = 0, damagedKg = 0, claimedKg = 0;
  let locationId = lot.baseLocationId ?? lot.locationId;
  let status = lot.expectedKg && movements.length === 0 ? "Expected" : (lot.status || "Expected");
  const ordered = [...movements].filter(m => !m.voided).sort(
    (a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (a.id || 0) - (b.id || 0)
  );
  let sawIn = false, sawShipOut = false;
  ordered.forEach(m => {
    const q = parseNum(m.qtyKg);
    switch (m.type) {
      case "IN": receivedKg += q; physicalKg += q; locationId = m.toId; sawIn = true; break;
      case "TRANSFER": locationId = m.toId; break;
      case "SHIP_OUT": physicalKg = Math.max(0, physicalKg - q); sawShipOut = true; break;
      case "REVERSAL": physicalKg += q; if (m.toId) locationId = m.toId; break;
      case "DAMAGE": physicalKg = Math.max(0, physicalKg - q); damagedKg += q; break;
      case "CLAIM": claimedKg += q; break;
      case "RECLASS": break;
      default: break;
    }
  });
  const loc = locById ? locById(locationId) : null;
  const legacyLocType = (loc as any)?.legacyType || loc?.type;
  if (sawShipOut && physicalKg === 0) status = "Shipped Out";
  else if (sawIn || physicalKg > 0) {
    if (legacyLocType === "OWN") status = "In Stock";
    else if (legacyLocType === "PORT") status = "Customs";
    else if (legacyLocType === "CLIENT") status = "Shipped Out";
    else status = "In Transit";
  } else if (movements.length === 0 && lot.expectedKg) {
    status = "Expected";
  }
  return { ...lot, movements: ordered, receivedKg, physicalKg, damagedKg, claimedKg, locationId, status };
}
