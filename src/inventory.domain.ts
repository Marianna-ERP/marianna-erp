import { parseNum } from "./numbers";   // v7.22.2 (FZ-22): the second exported reader is gone — one reader for every number
import { placeGroup } from "./locations";   // v7.27.3 (FZ-26)
// ─────────────────────────────────────────────────────────────────────────────
// inventory.domain.ts — pure inventory engine (Consolidation Batch 1)
//
// The movement→lot-state reducer, extracted verbatim from Inventory.tsx so it
// can be unit-tested and, later (BP-32), driven by shipment events. Pure: no
// React, no module state. The location taxonomy is injected (locById) so the
// reducer stays decoupled from the UI's location registry.
// Audit P2-3; tests in tests/run-engines.mjs (P2-5).
// ─────────────────────────────────────────────────────────────────────────────

export { parseNum };

export interface LocResolved { type?: string; placeType?: string; [k: string]: any }   // v7.27.3 (FZ-26): no old place code
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
  let receivedKg = 0, physicalKg = 0, damagedKg = 0, wasteKg = 0, claimedKg = 0;
  let overIssuedKg = 0; // Safeguards 7a: clamped excess, surfaced not swallowed
  let locationId = lot.baseLocationId ?? lot.locationId;
  // v6.35.5: voided movements must not count toward the status decision — a lot whose
  // postings were all voided (cancelled shipment) honestly returns to "Expected".
  // v7.40.0 (AUD3-B5, external audit: "same-day movements replay in typing order"): on the same day the goods come in before they move or
  // go out — IN, then TRANSFER / RECLASS, then SHIP_OUT / DAMAGE / CLAIM, a REVERSAL last — whatever order they were typed in
  const SAME_DAY_RANK: Record<string, number> = { IN: 0, TRANSFER: 1, RECLASS: 1, SHIP_OUT: 2, DAMAGE: 2, CLAIM: 2, REVERSAL: 3 };
  const rankOf = (m: any) => SAME_DAY_RANK[String(m?.kind || m?.type || "").toUpperCase()] ?? 2;
  const ordered = [...movements].filter(m => !m.voided).sort(
    (a, b) => String(a.date || "").slice(0, 10).localeCompare(String(b.date || "").slice(0, 10)) || rankOf(a) - rankOf(b) || String(a.date || "").localeCompare(String(b.date || "")) || (a.id || 0) - (b.id || 0)
  );
  let status = lot.expectedKg && ordered.length === 0 ? "Expected" : (lot.status || "Expected");
  let sawIn = false, sawShipOut = false;
  ordered.forEach(m => {
    const q = parseNum(m.qtyKg);
    switch (m.type) {
      case "IN": receivedKg += q; physicalKg += q; locationId = m.toId; sawIn = true; break;
      case "TRANSFER": locationId = m.toId; break;
      case "SHIP_OUT":
        // Safeguards 7a: an over-issue (shipping more than exists) is still
        // clamped for crash-safety, but no longer SILENT — the excess is
        // accumulated and surfaced by the integrity checker.
        if (q > physicalKg) overIssuedKg += q - physicalKg;
        physicalKg = Math.max(0, physicalKg - q); sawShipOut = true; break;
      case "REVERSAL": physicalKg += q; if (m.toId) locationId = m.toId; break;
      case "DAMAGE":
        // v6.99.34 (A-R24-1, owner): waste and damage are two different facts. What a SORTING job threw away is WASTE;
        // everything else — a shortfall against the PO, transit damage, a count adjustment — is DAMAGED. Counting the
        // sorting waste in both made the breakdown show the same number twice.
        if (q > physicalKg) overIssuedKg += q - physicalKg;
        physicalKg = Math.max(0, physicalKg - q);
        if (String(m.source || "").startsWith("sorting:")) wasteKg += q; else damagedKg += q;
        break;
      case "CLAIM": claimedKg += q; break;
      case "RECLASS": break;
      default: break;
    }
  });
  const loc = locById ? locById(locationId) : null;
  // v7.27.3 (FZ-26): the place's group from its TYPE (placeType where a screen shows the group in type) — never the old code
  // v7.21.14 (A-RV-37 · FZ-05): "Customs" only at a port, a port warehouse or an airport — by the place's TYPE (a place of type Other
  // also carries the old word "PORT"); the real type is placeType where a screen replaced type with the old word
  const realType = String((loc as any)?.placeType ?? loc?.type ?? "");
  const atPort = ["Port", "PortWarehouse", "Airport"].includes(realType);
  const group = placeGroup({ type: realType });
  if (sawShipOut && physicalKg === 0) status = "Shipped Out";
  else if (sawIn || physicalKg > 0) {
    if (group === "OWN") status = "In Stock";
    else if (atPort) status = "Customs";
    else if (group === "CLIENT") status = "Shipped Out";
    else status = "In Transit";
  } else if (ordered.length === 0 && lot.expectedKg) {
    status = "Expected";
  }
  // v6.99.111 (AUD-38): a voided movement is history, not nothing — it stays on the lot with its reason; only the arithmetic above skipped it
  const voided = [...movements].filter(m => m && m.voided);
  const all = [...ordered, ...voided].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (a.id || 0) - (b.id || 0));
  return { ...lot,
    overIssuedKg, movements: all, receivedKg, physicalKg, damagedKg, wasteKg, claimedKg, locationId, status };
}
